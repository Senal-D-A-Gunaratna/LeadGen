
import { create } from 'zustand';
import type { NewStudent, Student, StudentStore, AttendanceStatus } from '@/lib/types';
import { 
  getFilteredStudentsAction, 
  saveAttendanceAction, 
  addStudentAction, 
  removeStudentAction, 
  updateStudentAction, 
  deleteHistoryAction, 
  deleteAllStudentDataAction, 
  getStudentByIdAction 
} from '@/app/actions';
import { format } from 'date-fns';
import { useActionLogStore } from './use-action-log-store';
import { useAuthStore } from './use-auth-store';
import { produce, enableMapSet } from 'immer';
import { devtools } from 'zustand/middleware';
import { wsClient } from '@/lib/websocket-client';
import { shrinkStudentForList } from '@/lib/utils';

// Enable Immer MapSet plugin
enableMapSet();

const getCurrentTime = async (get: () => StudentStore): Promise<Date> => {
    const store = get();
    if (store.fakeDate) {
        return new Date(store.fakeDate);
    }
    return new Date();
};

export const useStudentStore = create<StudentStore>()(
  devtools(
    (set, get) => {
      // Initialize real-time listener for multi-user database changes (only once)
      let realtimeListenerInitialized = false;
      const initializeRealtimeListener = () => {
        if (realtimeListenerInitialized) return;
        realtimeListenerInitialized = true;
        
        // Listen for data changes from other users and automatically refetch
        wsClient.on('data_changed', () => {
          // Immediately refetch current data to detect changes made by other users
          get().actions.fetchAndSetStudents().catch(err => 
            console.error('Failed to refetch on data_changed event:', err)
          );
        });

        // Listen for server-pushed static filter updates and apply to store
        wsClient.on('static_filters_update', (payload: { grades?: string[]; classes?: string[]; roles?: string[] }) => {
          try {
            set({
              availableGrades: payload.grades || [],
              availableClasses: payload.classes || [],
              availableRoles: payload.roles || [],
            });
          } catch (err) {
            console.error('Failed to apply static_filters_update payload:', err);
          }
        });

        // Request initial static filters from server (best-effort)
        wsClient.getStaticFilters().then((resp) => {
          set({
            availableGrades: resp.grades || [],
            availableClasses: resp.classes || [],
            availableRoles: resp.roles || [],
          });
        }).catch((err) => {
          console.warn('Could not fetch initial static filters via WebSocket:', err);
        });
      };

      // Trigger initialization when store is first used
      if (typeof window !== 'undefined') {
        initializeRealtimeListener();
      }

      const fetchAndSetStudents = async () => {
        set({ isLoading: true });
        try {
          const { searchQuery, statusFilter, gradeFilter, classFilter, roleFilter, selectedDate, fakeDate } = get();
          const dateToFetch = selectedDate || fakeDate || new Date();
          const dateString = format(dateToFetch, 'yyyy-MM-dd');
          
          // Fetch the filtered list for the main UI
          const students = await getFilteredStudentsAction({
            date: dateString,
            searchQuery,
            statusFilter,
            gradeFilter,
            classFilter,
            roleFilter,
          });

          // Also fetch the complete roster for the same day to get an accurate total count
          const fullRoster = await getFilteredStudentsAction({
            date: dateString,
          });

          // Shrink payloads before storing in-memory to reduce RAM usage in the client
          const lightStudents = students.map(s => shrinkStudentForList(s));
          const lightFullRoster = fullRoster.map(s => shrinkStudentForList(s));

          // Derive dynamic filter lists from the full roster so the UI can
          // render filter options based on actual data present in the DB.
          const gradesSet = new Set<string>();
          const classesSet = new Set<string>();
          const rolesSet = new Set<string>();
          lightFullRoster.forEach(s => {
            if (s.grade !== undefined && s.grade !== null) gradesSet.add(String(s.grade));
            if (s.className) classesSet.add(s.className);
            if (s.role) rolesSet.add(String(s.role));
          });

          const derivedGrades = Array.from(gradesSet).sort((a,b) => Number(a) - Number(b));
          const derivedClasses = Array.from(classesSet).sort();
          const derivedRoles = Array.from(rolesSet).sort();

          set({ 
            students: lightStudents, 
            fullRoster: lightFullRoster, 
            isLoading: false,
            availableGrades: derivedGrades,
            availableClasses: derivedClasses,
            availableRoles: derivedRoles,
          });
        } catch (error) {
          console.error("Failed to fetch students:", error);
          set({ isLoading: false });
        }
      };

      return {
        students: [],
        fullRoster: [],
        studentSummaries: new Map(),
        isLoading: true,
        scannedStudent: null,
        recentScans: [],
        searchQuery: '',
        selectedStudent: null,
        statusFilter: null,
        gradeFilter: 'all',
        classFilter: 'all',
        roleFilter: 'all',
        selectedDate: undefined,
        fakeDate: null,
        availableGrades: [],
        availableClasses: [],
        availableRoles: [],
        // Local cache for pending manual attendance changes (studentId -> { status, checkInTime })
        pendingAttendanceChanges: {},
        
        actions: {
          fetchAndSetStudents,
          getCurrentAppTime: () => getCurrentTime(get),
          scanStudent: async (fingerprint) => {
            const { recentScans, selectedStudent, actions } = get();
            const scanTime = await actions.getCurrentAppTime();
            
            try {
              // Use WebSocket to scan student
              const updatedStudent = await wsClient.scanStudent(fingerprint);
              
              if (updatedStudent) {
                const studentWithTime = { ...updatedStudent, lastScanTime: scanTime.getTime() };

                // Optimistically update the UI with lightweight list entries
                set(produce((state: StudentStore) => {
                  const studentIndex = state.students.findIndex(s => s.id === studentWithTime.id);
                  if (studentIndex !== -1) {
                    state.students[studentIndex] = shrinkStudentForList(studentWithTime);
                  }
                  const fullRosterIndex = state.fullRoster.findIndex(s => s.id === studentWithTime.id);
                  if (fullRosterIndex !== -1) {
                    state.fullRoster[fullRosterIndex] = shrinkStudentForList(studentWithTime);
                  }

                  // Keep scannedStudent as a transient full-profile for display
                  state.scannedStudent = studentWithTime;
                  state.recentScans = [shrinkStudentForList(studentWithTime), ...state.recentScans.filter(s => s.id !== studentWithTime.id)].slice(0, 5);
                  if (state.selectedStudent?.id === studentWithTime.id) {
                    state.selectedStudent = studentWithTime;
                  }
                }));

                setTimeout(() => set({ scannedStudent: null }), 3000);
              }
            } catch (error) {
              console.error('Scan failed:', error);
              // Fallback to API if WebSocket fails
              const today = scanTime.toISOString().slice(0, 10);
              const allStudents = await getFilteredStudentsAction({ date: today });
              const studentToUpdate = allStudents.find(s => s.fingerprints.includes(fingerprint));
              
              if (studentToUpdate) {
                const refreshedStudent = { ...studentToUpdate, lastScanTime: scanTime.getTime() };
                set({
                  scannedStudent: refreshedStudent,
                  recentScans: [refreshedStudent, ...recentScans.filter(s => s.id !== refreshedStudent.id)].slice(0, 5),
                });
                setTimeout(() => set({ scannedStudent: null }), 3000);
              }
            }
          },
          setFakeDate: (date) => {
            set({ fakeDate: date });
          },
          setSearchQuery: (query) => {
            set({ searchQuery: query });
            get().actions.fetchAndSetStudents();
          },
          setStatusFilter: (status) => {
            set({ statusFilter: status });
            get().actions.fetchAndSetStudents();
          },
          setGradeFilter: (grade) => {
            set({ gradeFilter: grade });
            get().actions.fetchAndSetStudents();
          },
          setClassFilter: (className) => {
            set({ classFilter: className });
            get().actions.fetchAndSetStudents();
          },
          setRoleFilter: (role) => {
            set({ roleFilter: role });
            get().actions.fetchAndSetStudents();
          },
          setSelectedDate: (date) => {
            set({ selectedDate: date });
            get().actions.fetchAndSetStudents();
          },
          selectStudent: async (student) => {
            if (!student) {
                set({ selectedStudent: null });
                return;
            }
            // Always fetch the full, fresh data for the selected student
            try {
                const fullStudentProfile = await getStudentByIdAction(student.id);
                set({ selectedStudent: fullStudentProfile });
            } catch (error) {
                console.error("Failed to fetch student profile:", error);
                // Fallback to the potentially stale student object if the fetch fails
                set({ selectedStudent: student });
            }
          },
          // Clear in-memory cache (used when tab hidden/closed)
          clearCache: () => {
            set({ students: [], fullRoster: [], scannedStudent: null, recentScans: [] });
          },
          addStudent: async (newStudent: NewStudent) => {
            const { user } = useAuthStore.getState();
            const role = user?.role || 'user';
            useActionLogStore.getState().addActionLog(`[${role}] Added new student: ${newStudent.name}.`);

            const now = await get().actions.getCurrentAppTime();
            const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
            
            await addStudentAction(newStudent, timestamp, !!get().fakeDate);
            get().actions.fetchAndSetStudents(); // Refetch to show the new student
          },
          removeStudent: async (studentId) => {
            const { user } = useAuthStore.getState();
            const role = user?.role || 'user';
            const studentName = get().students.find(s => s.id === studentId)?.name || 'Unknown';
            useActionLogStore.getState().addActionLog(`[${role}] Removed student: ${studentName} (ID: ${studentId}).`);

            const now = await get().actions.getCurrentAppTime();
            const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
            await removeStudentAction(studentId, timestamp, !!get().fakeDate);
            get().actions.fetchAndSetStudents(); // Refetch
          },
          updateStudent: async (studentId, updatedDetails) => {
            await updateStudentAction(studentId, updatedDetails);
            get().actions.fetchAndSetStudents(); // Refetch
            // Also update selected student if it's the one being edited
            const { selectedStudent } = get();
            if (selectedStudent && selectedStudent.id === studentId) {
                const fullStudentProfile = await getStudentByIdAction(studentId);
                set({ selectedStudent: fullStudentProfile });
            }
          },
          updateBulkAttendance: async (date, changes) => {
            const dateString = format(date, 'yyyy-MM-dd');
            // changes may map studentId -> AttendanceStatus OR -> { status, checkInTime }
            const studentsToUpdate = await getFilteredStudentsAction({ date: dateString });
            const updatedStudents = studentsToUpdate.map(student => {
              const change = changes[student.id];
              if (change) {
                const history = [...student.attendanceHistory];
                const recordIndex = history.findIndex(h => h.date === dateString);
                // Normalize incoming change
                let newStatus: any = null;
                let checkInTime: string | undefined = undefined;
                if (typeof change === 'string') {
                  newStatus = change;
                } else if (typeof change === 'object' && change !== null) {
                  newStatus = (change as any).status;
                  checkInTime = (change as any).checkInTime;
                }

                if (recordIndex !== -1) {
                  history[recordIndex] = { ...history[recordIndex], status: newStatus };
                  if (checkInTime !== undefined) {
                    history[recordIndex].checkInTime = checkInTime;
                  }
                } else {
                  const newRecord: any = { date: dateString, status: newStatus };
                  if (checkInTime !== undefined) newRecord.checkInTime = checkInTime;
                  history.unshift(newRecord);
                }
                history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                return { ...student, attendanceHistory: history };
              }
              return student;
            }).filter(s => changes[s.id]); // Only save students that were changed

            await saveAttendanceAction(updatedStudents);
            get().actions.fetchAndSetStudents(); // Refetch to show updated data
          },
          // Manage a local cache of pending attendance changes so the UI can batch them
          addPendingAttendanceChange: (studentId: number, change: any) => {
            set(produce((state: StudentStore) => {
              state.pendingAttendanceChanges = {
                ...(state.pendingAttendanceChanges || {}),
                [studentId]: {
                  ...(state.pendingAttendanceChanges?.[studentId] || {}),
                  ...change,
                }
              };
            }));
          },
          setFilterOptions: (opts: { grades?: string[]; classes?: string[]; roles?: string[] }) => {
            set({
              availableGrades: opts.grades || [],
              availableClasses: opts.classes || [],
              availableRoles: opts.roles || [],
            });
          },
          clearPendingAttendanceChanges: () => {
            set({ pendingAttendanceChanges: {} });
          },
          // Clear UI filters (search + grade/class/role/status) and reset selected date to today (or fakeDate if set)
          // Also aggressively clear all cached data when leaving a tab
          clearFilters: () => {
            const fake = get().fakeDate;
            const dateToSet = fake ? new Date(fake) : new Date();
            // Clear all cached student data and reset filters
            set({ 
              searchQuery: '', 
              gradeFilter: 'all', 
              classFilter: 'all', 
              roleFilter: 'all', 
              statusFilter: null, 
              selectedDate: dateToSet,
              // Aggressive cache clearing
              students: [],
              fullRoster: [],
              scannedStudent: null,
              recentScans: [],
              selectedStudent: null,
            });
          },
          // Reset filters and refetch students for default view (also reset selected date)
          resetToDefault: async () => {
            const fake = get().fakeDate;
            const dateToSet = fake ? new Date(fake) : new Date();
            set({ searchQuery: '', gradeFilter: 'all', classFilter: 'all', roleFilter: 'all', statusFilter: null, selectedDate: dateToSet });
            await fetchAndSetStudents();
          },
          flushPendingAttendanceChanges: async (date) => {
            const pending = get().pendingAttendanceChanges || {};
            if (!date || Object.keys(pending).length === 0) return;
            try {
              await get().actions.updateBulkAttendance(date, pending);
              set({ pendingAttendanceChanges: {} });
            } catch (err) {
              console.error("Failed to flush pending attendance changes:", err);
              throw err;
            }
          },
          resetDailyData: async () => {
            const now = await get().actions.getCurrentAppTime();
            const today = format(now, 'yyyy-MM-dd');
            const allStudents = await getFilteredStudentsAction({ date: today });
            const changes: Record<number, AttendanceStatus> = {};
            allStudents.forEach(s => {
              changes[s.id] = 'absent';
            });
            await get().actions.updateBulkAttendance(now, changes);
            set({ recentScans: [] });
          },
          deleteEntireHistory: async () => {
            await deleteHistoryAction();
            get().actions.fetchAndSetStudents();
          },
          deleteAllStudentData: async () => {
            await deleteAllStudentDataAction();
            get().actions.fetchAndSetStudents();
          },
          updateStudentSummaries: (summaries: { studentId: number; summary: any }[]) => {
            set(produce((state) => {
              summaries.forEach(({ studentId, summary }) => {
                state.studentSummaries.set(studentId, summary);
              });
            }));
          }
        },
      }
    },
    { name: 'StudentStore' }
  )
);

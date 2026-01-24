
"use client";

import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { getFilteredStudentsAction } from '@/app/actions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStudentStore } from "@/hooks/use-student-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { useToast } from "@/hooks/use-toast";
import type { AttendanceStatus, Student } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { MonthYearSelector } from "../ui/month-year-selector";
import { cn } from "@/lib/utils";
import { Search, X, Calendar as CalendarIcon, Save, Loader2, RotateCcw, ChevronDown } from "lucide-react";
import { MdFilterAltOff } from "react-icons/md";
import { RolePasswordDialog } from "../dashboard/role-password-dialog";
 

type PendingChanges = Record<number, { status: AttendanceStatus | 'null'; checkInTime?: string | null }>;

const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

export function ManualAttendanceTab() {
  const { students, actions, fakeDate, searchQuery, gradeFilter, classFilter, roleFilter, isLoading, pendingAttendanceChanges, availableGrades: availableGradesFromStore, availableClasses: availableClassesFromStore, availableRoles: availableRolesFromStore } = useStudentStore(
    state => ({
      students: state.students,
      actions: state.actions,
      fakeDate: state.fakeDate,
      searchQuery: state.searchQuery,
      gradeFilter: state.gradeFilter,
      classFilter: state.classFilter,
      roleFilter: state.roleFilter,
      isLoading: state.isLoading,
      pendingAttendanceChanges: state.pendingAttendanceChanges,
      availableGrades: state.availableGrades,
      availableClasses: state.availableClasses,
      availableRoles: state.availableRoles,
    })
  );
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const { toast } = useToast();
  const { setSearchQuery, setGradeFilter, setClassFilter, setRoleFilter, selectStudent, setSelectedDate, fetchAndSetStudents } = actions;
  const clearFilters = () => {
    setSearchQuery('');
    setGradeFilter('all');
    setClassFilter('all');
    setRoleFilter('all');
  };
  
  const selectedDate = useStudentStore(state => state.selectedDate);
  // pendingAttendanceChanges now lives in the central store so multiple components
  // can modify attendance and it will be flushed in one go.
  const [isSaving, setIsSaving] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [displayedMonth, setDisplayedMonth] = useState<Date>(selectedDate ? new Date(selectedDate) : new Date());

  // Small combo control: editable input + popover two-column picker (hours/minutes)
  function TimeCombo({ studentId, value, onChange }: { studentId: number; value: string; onChange: (v: string | null) => void }) {
    const [open, setOpen] = useState(false);
    const [selectedHour, setSelectedHour] = useState<string | null>(null);

    const HOURS = Array.from({ length: 24 }).map((_, i) => String(i).padStart(2, '0'));
    const MINUTES = Array.from({ length: 60 }).map((_, i) => String(i).padStart(2, '0'));

    const handleHourClick = (h: string) => {
      setSelectedHour(h);
    };

    const handleMinuteClick = (m: string) => {
      const hh = selectedHour ?? (value ? value.split(':')[0] : '07');
      const newVal = `${hh}:${m}`;
      setSelectedHour(null);
      setOpen(false);
      onChange(newVal);
    };

    const handleInputChange = (e: any) => {
      onChange(e.target.value || null);
    };

    const handleInputBlur = (e: any) => {
      const v = e.target.value || '';
      if (!v) {
        onChange(null);
        return;
      }
      // Allow HH:mm only
      if (!/^\d{2}:\d{2}$/.test(v)) {
        onChange(null);
        return;
      }
      onChange(v);
    };

    return (
      <div className="relative">
        <div className="glassmorphic rounded-md flex items-center w-[140px] pr-1">
          <input
            value={value || ''}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder="--:--"
            aria-label={`Check-in time input`}
            className="bg-transparent border-none outline-none px-3 py-2 w-full"
          />
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="Open time picker"
                className="h-8 w-8 flex items-center justify-center text-muted-foreground"
                style={{ padding: 0 }}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-[260px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="max-h-56 overflow-y-auto">
                {HOURS.map(h => (
                  <button
                    key={h}
                    className={`w-full text-left p-1 ${selectedHour === h ? 'bg-primary text-white' : 'hover:bg-muted/30'}`}
                    onClick={() => handleHourClick(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <div className="max-h-56 overflow-y-auto">
                {MINUTES.map(m => (
                  <button
                    key={m}
                    className="w-full text-left p-1 hover:bg-muted/30"
                    onClick={() => handleMinuteClick(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        </div>
      </div>
    );
  }

  useEffect(() => {
    setSelectedDate(fakeDate ? new Date(fakeDate) : new Date());
  }, [fakeDate, setSelectedDate]);
  
  useEffect(() => {
    // Clear pending changes when the date changes in the store
    actions.clearPendingAttendanceChanges && actions.clearPendingAttendanceChanges();
  }, [selectedDate]);

  // Global handler clears filters on tab change; no per-tab cleanup here.

  // Refetch when any filter changes
  useEffect(() => {
    fetchAndSetStudents();
  }, [searchQuery, gradeFilter, classFilter, roleFilter, selectedDate, fetchAndSetStudents]);

  // Keep a local copy of full student objects (with attendanceHistory) so
  // the Manual Attendance UI can show per-student `checkInTime` values.
  const [fullStudents, setFullStudents] = useState<Student[]>([]);
  useEffect(() => {
    let mounted = true;
    const fetchFull = async () => {
      try {
        const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
        const res = await getFilteredStudentsAction({ date: dateStr, searchQuery, statusFilter: null, gradeFilter, classFilter, roleFilter });
        if (mounted) setFullStudents(res);
      } catch (e) {
        console.error('Failed to fetch full students for Manual Attendance', e);
      }
    };
    fetchFull();
    return () => { mounted = false; };
  }, [selectedDate, searchQuery, gradeFilter, classFilter, roleFilter]);

  const availableGrades = availableGradesFromStore || [];
  const availableClasses = availableClassesFromStore || [];
  const availableRoles = availableRolesFromStore || [];

  // We'll compute the display status inline to avoid changing the `Student` type
  // (so we never pass a non-Student shaped object to `selectStudent`).

  const timeToStatus = (timeStr: string | null | undefined) : AttendanceStatus => {
    if (!timeStr) return 'absent';
    try {
      const [hh, mm] = timeStr.split(':').map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) return 'absent';
      const totalMinutes = hh * 60 + mm;
      const cutoffMinutes = 7 * 60 + 15; // 07:15 -> cutoff between on time and late
      return totalMinutes <= cutoffMinutes ? 'on time' : 'late';
    } catch (e) {
      return 'absent';
    }
  };

  const handleStatusChange = (studentId: number, newStatus: AttendanceStatus | 'null') => {
    // When user sets status directly, update the pending checkInTime accordingly
    let impliedTime: string | null | undefined = undefined;
    if (newStatus === 'on time') impliedTime = '07:14';
    else if (newStatus === 'late') impliedTime = '07:16';
    else if (newStatus === 'absent') impliedTime = null;

    actions.addPendingAttendanceChange && actions.addPendingAttendanceChange(studentId, { status: newStatus, checkInTime: impliedTime });
  };

  const handleTimeChange = (studentId: number, timeValue: string | null) => {
    // When user changes time, auto-calc status from time
    const derivedStatus = timeToStatus(timeValue ?? null);
    actions.addPendingAttendanceChange && actions.addPendingAttendanceChange(studentId, { status: derivedStatus, checkInTime: timeValue });
  };

  const handleSaveChanges = () => {
    if (selectedDate && isWeekend(selectedDate)) {
      toast({ variant: "destructive", title: "Weekend Not Allowed", description: "Attendance cannot be marked for weekend dates." });
      return;
    }
    const pending = pendingAttendanceChanges || {};
    const validChanges = Object.values(pending).filter((ch: any) => ch && (ch.status !== 'null' || ch.checkInTime !== undefined));
    if (validChanges.length === 0) {
      toast({ title: "No Changes", description: "You haven't made any valid attendance changes to save." });
      return;
    }
    setIsAuthOpen(true);
  }
  
  const handleAuthorizedSave = async (password?: string) => {
    setIsAuthOpen(false);
    setIsSaving(true);
    try {
        if (!selectedDate) {
            throw new Error("No date selected.");
        }
        if (isWeekend(selectedDate)) {
            throw new Error("Cannot save attendance for weekend dates.");
        }
        // Build a properly typed changes map from the store pending cache
        const changesToSave: Record<number, any> = {};
        const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
        const pending = pendingAttendanceChanges || {};
        Object.entries(pending).forEach(([k, changeObj]) => {
          const id = Number(k);
          if (Number.isNaN(id)) return;
          const status = changeObj?.status;
          if (!status || status === 'null') return;
          if (changeObj.checkInTime && selectedDateStr) {
            const timePart = changeObj.checkInTime;
            const iso = `${selectedDateStr}T${timePart}:00`;
            changesToSave[id] = { status, checkInTime: iso };
          } else {
            changesToSave[id] = status;
          }
        });
        if (Object.keys(changesToSave).length === 0) {
          toast({ title: "No Changes", description: "No valid attendance changes to save (null statuses are not saved)." });
          actions.clearPendingAttendanceChanges && actions.clearPendingAttendanceChanges();
          setIsSaving(false);
          return;
        }
        await actions.updateBulkAttendance(selectedDate, changesToSave);
        addActionLog(`[${user?.role}] Manually marked attendance for ${format(selectedDate, 'PPP')}.`);
        toast({ title: "Attendance Updated", description: `Manual attendance changes for ${format(selectedDate, 'PPP')} have been saved.` });
        actions.clearPendingAttendanceChanges && actions.clearPendingAttendanceChanges();
    } catch(e) {
        console.error(e);
        toast({ variant: "destructive", title: "Save Failed", description: "An unexpected error occurred while saving." });
    } finally {
        setIsSaving(false);
    }
  }

  const hasPendingChanges = Object.values(pendingAttendanceChanges || {}).some((ch: any) => ch && ch.status !== 'null');

  return (
    <>
      <Card className="glassmorphic glowing-border min-h-[750px]">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Manual Attendance Marking</CardTitle>
          <CardDescription>
            Select a date and manually set the attendance status for students. Changes are saved in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 w-full mb-4">
            <div className="relative flex-grow min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone number"
                className="pl-9 pr-9 glassmorphic"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full sm:w-auto justify-start text-left font-normal glassmorphic",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3">
                <div className="space-y-3">
                  <MonthYearSelector
                    displayedMonth={displayedMonth}
                    onMonthChange={setDisplayedMonth}
                    showYearSelector={true}
                  />
                </div>
                <Calendar
                  mode="single"
                  month={displayedMonth}
                  onMonthChange={setDisplayedMonth}
                  selected={selectedDate}
                  onSelect={(date) => setSelectedDate(date)}
                  disabled={(date) => date > new Date() || date < new Date("2000-01-01") || isWeekend(date)}
                  classNames={{ caption: 'hidden' }}
                  initialFocus
                  weekStartsOn={1}
                />
              </PopoverContent>
            </Popover>
             <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                <SelectValue placeholder="Filter by grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {availableGrades.map(grade => (
                  <SelectItem key={grade} value={grade}>Grade {grade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                <SelectValue placeholder="Filter by class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {availableClasses.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
             <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="glassmorphic w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                     <SelectItem value="none">No Role</SelectItem>
                    {availableRoles.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="ml-auto">
              <Button variant="outline" size="icon" onClick={clearFilters} aria-label="Clear filters">
                <MdFilterAltOff className="h-5 w-5 text-muted-foreground" />
              </Button>
            </div>
          </div>

          <div className="max-h-[600px] overflow-y-auto pr-2">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <TableRow className="hover:bg-transparent">
                      <TableHead>Name</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Check In Time</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Check if any student has no attendance data for this date
                    const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
                    const hasAnyMissingData = students.some(student => {
                      const fullStudent = fullStudents.find(s => s.id === student.id) as Student | undefined;
                      const record = (fullStudent?.attendanceHistory || student.attendanceHistory).find(h => h.date === selectedDateStr);
                      return !record;
                    });

                    return students.map((student) => {
                    const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
                    const fullStudent = fullStudents.find(s => s.id === student.id) as Student | undefined;
                    const record = (fullStudent?.attendanceHistory || student.attendanceHistory).find(h => h.date === selectedDateStr) as any | undefined;

                    // derive existing time string (HH:mm) from record.checkInTime if present
                    const existingTime = record && record.checkInTime ? (() => {
                      // Support multiple formats returned from backend: ISO `YYYY-MM-DDTHH:MM:SS`,
                      // space-separated `YYYY-MM-DD HH:MM:SS`, or plain `HH:MM(:SS)`.
                      const raw: string = String(record.checkInTime || '');
                      // Try to extract HH:MM via regex first
                      const m = raw.match(/(\d{2}):(\d{2})/);
                      if (m) return `${m[1]}:${m[2]}`;
                      // Fallback to Date parsing
                      try {
                        const d = new Date(raw);
                        if (!Number.isNaN(d.getTime())) {
                          const hh = String(d.getHours()).padStart(2, '0');
                          const mm = String(d.getMinutes()).padStart(2, '0');
                          return `${hh}:${mm}`;
                        }
                      } catch (e) {}
                      return '';
                    })() : '';

                    const pending = (pendingAttendanceChanges || {})[student.id];
                    const timeValue = pending?.checkInTime !== undefined ? (pending.checkInTime ?? '') : existingTime;
                    // Determine display status: prefer pending.status if present; otherwise derive from time (pending or existing) or fallback to record.status
                    const displayStatus: AttendanceStatus | 'null' = (pending && pending.status && pending.status !== 'null')
                      ? pending.status as AttendanceStatus
                      : (pending && pending.checkInTime !== undefined ? timeToStatus(pending.checkInTime) : (existingTime ? timeToStatus(existingTime) : (record ? record.status : (hasAnyMissingData ? 'null' : 'absent'))));

                    return (
                      <TableRow key={student.id} className="border-border/40 hover:bg-muted/60 transition-all duration-150 ease-out will-change-transform">
                        <TableCell className="font-medium cursor-pointer" onClick={() => selectStudent(student)}>{student.name}</TableCell>
                        <TableCell>{student.grade}</TableCell>
                        <TableCell>{student.className}</TableCell>
                            <TableCell>
                              <TimeCombo
                                studentId={student.id}
                                value={timeValue}
                                onChange={(val) => handleTimeChange(student.id, val)}
                              />
                            </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Select 
                              value={displayStatus as unknown as string}
                              onValueChange={(newStatus: AttendanceStatus | 'null') => handleStatusChange(student.id, newStatus)}
                            >
                              <SelectTrigger className="w-[120px] glassmorphic">
                                <SelectValue placeholder="Set status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="on time">On Time</SelectItem>
                                <SelectItem value="late">Late</SelectItem>
                                <SelectItem value="absent">Absent</SelectItem>
                                <SelectItem value="null">Null</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  });
                  })()}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
            {hasPendingChanges && (
              <Button variant="ghost" onClick={() => actions.clearPendingAttendanceChanges && actions.clearPendingAttendanceChanges()} disabled={isSaving}>
                   <RotateCcw className="mr-2 h-4 w-4" />
                   Discard Changes
                </Button>
            )}
            <Button onClick={handleSaveChanges} disabled={!hasPendingChanges || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
            </Button>
        </CardFooter>
      </Card>
      {user?.role && (
        <RolePasswordDialog
          role={user.role}
          open={isAuthOpen}
          onOpenChange={setIsAuthOpen}
          onSuccess={handleAuthorizedSave}
          title="Authorize Attendance Update"
          description={`Enter your ${user.role} password to save these attendance changes.`}
        />
      )}
    </>
  );
}

import type { DayPicker } from 'react-day-picker';

export type AttendanceStatus = 'on time' | 'absent' | 'late';

export type PrefectRole =
  | "Head Prefect"
  | "Deputy Head Prefect"
  | "Super Senior Prefect"
  | "Senior Prefect"
  | "Junior Prefect"
  | "Sports Captain"
  | "Science Club President"
  | "Debate Team Captain";

export type AttendanceRecord = {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  checkInTime?: string;
};

export type Student = {
  id: number;
  fingerprints: [string, string, string, string];
  name: string;
  grade: number;
  className: string;
  status: AttendanceStatus;
  hasScannedToday: boolean;
  lastScanTime?: number;
  role?: PrefectRole;
  specialRoles?: string;
  notes?: string;
  contact: {
    email: string;
    phone: string;
  };
  attendanceHistory: AttendanceRecord[];
};

// Represents a new student being added, without app-generated fields like id
export type NewStudent = Omit<
  Student,
  'id' | 'status' | 'hasScannedToday' | 'lastScanTime' | 'attendanceHistory'
> & {
  fingerprints?: [string, string, string, string];
};

export type AttendanceSummary = {
  totalSchoolDays: number;
  presentDays: number;
  absentDays: number;
  onTimeDays: number;
  lateDays: number;
  presencePercentage: number;
  absencePercentage: number;
  onTimePercentage: number;
  latePercentage: number;
};

export type StudentStore = {
  students: Student[]; // This is the filtered list for the UI
  fullRoster: Student[]; // This is the complete, unfiltered list for stats
  studentSummaries: Map<number, AttendanceSummary>; // Cached summaries from backend
  isLoading: boolean;
  scannedStudent: Student | null;
  recentScans: Student[];
  searchQuery: string;
  selectedStudent: Student | null;
  statusFilter: AttendanceStatus | null;
  gradeFilter: string;
  classFilter: string;
  roleFilter: string;
  selectedDate: Date | undefined;
  fakeDate: Date | null;
  pendingAttendanceChanges?: Record<
    number,
    { status?: AttendanceStatus | 'null'; checkInTime?: string | null }
  >;

  actions: {
    fetchAndSetStudents: () => Promise<void>;
    getCurrentAppTime: () => Promise<Date>;
    scanStudent: (fingerprint: string) => void;
    setSearchQuery: (query: string) => void;
    setStatusFilter: (status: AttendanceStatus | null) => void;
    setGradeFilter: (grade: string) => void;
    setClassFilter: (className: string) => void;
    setRoleFilter: (role: string) => void;
    setSelectedDate: (date: Date | undefined) => void;
    selectStudent: (student: Student | null) => void;
    addStudent: (newStudent: NewStudent) => Promise<void>;
    removeStudent: (studentId: number) => Promise<void>;
    updateStudent: (
      studentId: number,
      updatedDetails: Partial<Omit<Student, 'id'>>
    ) => Promise<void>;
    updateBulkAttendance: (date: Date, changes: Record<number, any>) => Promise<void>;
    addPendingAttendanceChange: (studentId: number, change: any) => void;
    clearPendingAttendanceChanges: () => void;
    flushPendingAttendanceChanges: (date: Date) => Promise<void>;
    // Clear UI filters to default values (used when leaving tabs)
    clearFilters: () => void;
    // Optionally reset store to defaults and refetch
    resetToDefault?: () => Promise<void>;
    resetDailyData: () => Promise<void>;
    deleteEntireHistory: () => Promise<void>;
    deleteAllStudentData: () => Promise<void>;
    setFakeDate: (date: Date | null) => void;
    clearCache: () => void;
    updateStudentSummaries: (
      summaries: { studentId: number; summary: AttendanceSummary }[]
    ) => void;
  };
};

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

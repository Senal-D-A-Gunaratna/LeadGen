

import type { DayPicker } from 'react-day-picker';

export type AttendanceStatus = 'on time' | 'absent' | 'late';

export type PrefectRole = "Head Prefect" | "Deputy Head Prefect" | "Super Senior Prefect" | "Senior Prefect" | "Junior Prefect" | "Sports Captain" | "Science Club President" | "Debate Team Captain";

export type AttendanceRecord = {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
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
export type NewStudent = Omit<Student, 'id' | 'status' | 'hasScannedToday' | 'lastScanTime' | 'attendanceHistory'> & {
  fingerprints?: [string, string, string, string];
};


export type StudentStore = {
  students: Student[]; // This is the filtered list for the UI
  fullRoster: Student[]; // This is the complete, unfiltered list for stats
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
    updateStudent: (studentId: number, updatedDetails: Partial<Omit<Student, 'id'>>) => Promise<void>;
    updateBulkAttendance: (date: Date, changes: Record<number, AttendanceStatus>) => Promise<void>;
    resetDailyData: () => Promise<void>;
    deleteEntireHistory: () => Promise<void>;
    deleteAllStudentData: () => Promise<void>;
    setFakeDate: (date: Date | null) => void;
    clearCache: () => void;
  };
};

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

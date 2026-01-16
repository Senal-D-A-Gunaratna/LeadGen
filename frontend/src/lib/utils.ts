
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Student } from "./types"
import { parseISO, getDay } from 'date-fns';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parses a date string into a Date object, handling timezone correctly.
 * @param dateString The date string in YYYY-MM-DD format.
 * @returns A Date object.
 */
export function parseDate(dateString: string): Date {
  // Appends T00:00:00 to ensure the date is parsed in the local timezone,
  // not UTC. This prevents off-by-one-day errors.
  return parseISO(dateString + 'T00:00:00');
}

/**
 * Determines if a given date was a weekday.
 * @param date The date to check.
 * @returns True if it was a weekday, false otherwise.
 */
export function isWeekday(date: Date): boolean {
  const day = getDay(date);
  // Sundays (0) and Saturdays (6) are not school days.
  return day > 0 && day < 6;
}

/**
 * Calculates detailed attendance statistics for a single student against all school days.
 * A school day is defined as a weekday where at least one student has an attendance record.
 * @param student The student to calculate for.
 * @param allStudents The list of all students to determine which days were school days.
 * @returns An object with detailed attendance statistics.
 */
export function getAttendanceSummary(student: Student, allStudents: Student[]) {
  const schoolDays = new Set<string>();

  // Determine all unique school days from all students' histories.
  allStudents.forEach(s => {
    s.attendanceHistory.forEach(record => {
      try {
        const recordDate = parseDate(record.date);
        if (isWeekday(recordDate)) {
          schoolDays.add(record.date);
        }
      } catch (e) {
        // Ignore invalid dates
      }
    });
  });

  const totalSchoolDays = schoolDays.size;

  if (totalSchoolDays === 0) {
    return {
      totalSchoolDays: 0,
      presentDays: 0,
      absentDays: 0,
      onTimeDays: 0,
      lateDays: 0,
      presencePercentage: 0,
      absencePercentage: 0,
      onTimePercentage: 0,
      latePercentage: 0,
    };
  }

  const studentRecordsOnSchoolDays = student.attendanceHistory.filter(record => schoolDays.has(record.date));
  
  const onTimeDays = studentRecordsOnSchoolDays.filter(r => r.status === 'on time').length;
  const lateDays = studentRecordsOnSchoolDays.filter(r => r.status === 'late').length;
  const presentDays = onTimeDays + lateDays;
  
  // Absent days are total school days minus the days the student was present.
  const absentDays = totalSchoolDays - presentDays;
  
  const presencePercentage = Math.round((presentDays / totalSchoolDays) * 100);
  const absencePercentage = 100 - presencePercentage;
  
  // "On Time" and "Late" percentages are based on the days the student was actually present.
  const onTimePercentage = presentDays > 0 ? Math.round((onTimeDays / presentDays) * 100) : 0;
  const latePercentage = presentDays > 0 ? Math.round((lateDays / presentDays) * 100) : 0;

  return {
    totalSchoolDays,
    presentDays,
    absentDays,
    onTimeDays,
    lateDays,
    presencePercentage,
    absencePercentage,
    onTimePercentage,
    latePercentage,
  };
}


/**
 * Calculates a student's attendance percentage against all actual school days.
 * A school day is defined as a weekday where at least one student has an attendance record.
 * @param student The student to calculate for.
 * @param allStudents The list of all students to determine which days were school days.
 * @returns The attendance percentage.
 */
export function calculateAttendancePercentage(student: Student, allStudents: Student[]): number {
  const { presencePercentage } = getAttendanceSummary(student, allStudents);
  return presencePercentage;
}

/**
 * Shrinks a full `Student` object into a lightweight form suitable for list views.
 * - Clears large arrays like `attendanceHistory` and `fingerprints`.
 * - Removes contact details and notes to reduce RAM usage on the client.
 * The UI should fetch the full student profile on demand (see `selectStudent`).
 */
export function shrinkStudentForList(student: Student): Student {
  return {
    ...student,
    // Replace potentially-large arrays/objects with small placeholders
    fingerprints: ['','','',''],
    attendanceHistory: [],
    contact: { email: '', phone: '' },
    notes: undefined,
    specialRoles: undefined,
  };
}

/**
 * Server actions - now using Flask backend API.
 * Maintains same function signatures for compatibility with frontend.
 */

import type { Student, AttendanceRecord, NewStudent, PrefectRole, AttendanceStatus } from '@/lib/types';
import type { Role } from '@/hooks/use-auth-store';
import type { ActionLogEntry } from '@/hooks/use-action-log-store';
import type { LogEntry } from '@/hooks/use-log-store';
import {
  getFilteredStudents as apiGetFilteredStudents,
  getStudentById as apiGetStudentById,
  saveAttendance as apiSaveAttendance,
  addStudent as apiAddStudent,
  removeStudent as apiRemoveStudent,
  updateStudent as apiUpdateStudent,
  validatePassword as apiValidatePassword,
  updatePasswords as apiUpdatePasswords,
  getCurrentTime as apiGetCurrentTime,
  createBackup as apiCreateBackup,
  listBackups as apiListBackups,
  restoreBackup as apiRestoreBackup,
  downloadBackup as apiDownloadBackup,
  deleteBackup as apiDeleteBackup,
  deleteAllBackups as apiDeleteAllBackups,
  downloadStudentDataAsCsv as apiDownloadStudentDataAsCsv,
  downloadStudentDataAsJson as apiDownloadStudentDataAsJson,
  uploadStudentDataFromCsv as apiUploadStudentDataFromCsv,
  uploadStudentDataFromJson as apiUploadStudentDataFromJson,
  downloadAttendanceHistoryAsJson as apiDownloadAttendanceHistoryAsJson,
  downloadDetailedAttendanceHistoryAsCsv as apiDownloadDetailedAttendanceHistoryAsCsv,
  downloadAttendanceSummaryAsCsv as apiDownloadAttendanceSummaryAsCsv,
  downloadStudentAttendanceSummaryAsCsv as apiDownloadStudentAttendanceSummaryAsCsv,
  downloadStudentDataAsPdf as apiDownloadStudentDataAsPdf,
  downloadAttendanceSummaryAsPdf as apiDownloadAttendanceSummaryAsPdf,
  downloadStudentAttendanceSummaryAsPdf as apiDownloadStudentAttendanceSummaryAsPdf,
  getActionLogs as apiGetActionLogs,
  appendToActionLog as apiAppendToActionLog,
  clearActionLogs as apiClearActionLogs,
  getAuthLogs as apiGetAuthLogs,
  appendToAuthLog as apiAppendToAuthLog,
  clearAuthLogs as apiClearAuthLogs,
  deleteHistory as apiDeleteHistory,
  deleteAllStudentData as apiDeleteAllStudentData,
} from '@/lib/api-client';

// --- Log Actions ---

export async function getActionLogsAction(): Promise<ActionLogEntry[]> {
  const logs = await apiGetActionLogs();
  // Backend returns { timestamp: string, action: string }
  // Frontend expects { timestamp: Date, message: string }
  return logs.map(log => ({
    timestamp: new Date(log.timestamp),
    message: log.action || log.message || ''
  }));
}

export async function appendToActionLogAction(logEntry: ActionLogEntry): Promise<void> {
  try {
    // Convert Date to ISO string and use 'message' field (which is the action text)
    const timestamp = logEntry.timestamp instanceof Date 
      ? logEntry.timestamp.toISOString() 
      : new Date(logEntry.timestamp).toISOString();
    const action = logEntry.message || (logEntry as any).action || '';
    
    if (!action) {
      console.warn('appendToActionLogAction: Empty action message');
      return;
    }
    
    await apiAppendToActionLog(timestamp, action);
  } catch (error) {
    // Silently fail - action logs are not critical
    console.error('Failed to append action log:', error);
  }
}

export async function clearActionLogsAction(role: Role): Promise<void> {
  await apiClearActionLogs(role);
}

// Auth Logs
export async function getAuthLogsAction(): Promise<LogEntry[]> {
  return apiGetAuthLogs();
}

export async function appendToAuthLogAction(logEntry: LogEntry): Promise<void> {
  await apiAppendToAuthLog(logEntry.timestamp, logEntry.message);
}

export async function clearAuthLogsAction(role: Role): Promise<void> {
  await apiClearAuthLogs(role);
}

// --- Backup Actions ---

export async function createBackupAction(dataType: 'students' | 'attendance', timestamp: string, isFrozen: boolean): Promise<string> {
  return apiCreateBackup(dataType, timestamp, isFrozen);
}

export async function listBackupsAction(): Promise<{ students: string[], attendance: string[] }> {
  return apiListBackups();
}

export async function restoreBackupAction(dataType: 'students' | 'attendance', fileName: string): Promise<void> {
  await apiRestoreBackup(dataType, fileName);
}

export async function deleteBackupAction(dataType: 'students' | 'attendance', fileName: string): Promise<void> {
  await apiDeleteBackup(dataType, fileName);
}

export async function downloadBackupAction(dataType: 'students' | 'attendance', fileName: string): Promise<string> {
  return apiDownloadBackup(dataType, fileName);
}

export async function deleteAllBackupsAction(): Promise<void> {
  await apiDeleteAllBackups();
}

// --- Password Actions ---

export async function validatePasswordAction(role: Role, password?: string): Promise<boolean> {
  if (!password) return false;
  return apiValidatePassword(role, password);
}

export async function updatePasswordsAction(passwordsToUpdate: Partial<Record<Role, string>>, authorizerRole: Role, authorizerPassword?: string): Promise<void> {
  await apiUpdatePasswords(passwordsToUpdate as Record<string, string>, authorizerRole, authorizerPassword || '');
}

// --- Student Actions ---

export async function getFilteredStudentsAction(filters: {
  date?: string;
  searchQuery?: string | null;
  statusFilter?: AttendanceStatus | null;
  gradeFilter?: string | null;
  classFilter?: string | null;
  roleFilter?: string | null;
}): Promise<Student[]> {
  return apiGetFilteredStudents(filters);
}

export async function getStudentByIdAction(studentId: number): Promise<Student | null> {
  try {
    return await apiGetStudentById(studentId);
  } catch {
    return null;
  }
}

export async function saveAttendanceAction(students: Student[]): Promise<void> {
  await apiSaveAttendance(students);
}

export async function addStudentAction(newStudent: NewStudent, timestamp: string, isFrozen: boolean): Promise<Student> {
  return apiAddStudent(newStudent);
}

export async function removeStudentAction(studentId: number, timestamp: string, isFrozen: boolean): Promise<void> {
  await apiRemoveStudent(studentId);
}

export async function updateStudentAction(studentId: number, updatedDetails: Partial<Omit<Student, 'id'>>): Promise<void> {
  await apiUpdateStudent(studentId, updatedDetails);
}

// --- CSV/JSON Upload/Download Actions ---

export async function uploadStudentDataFromCsvAction(csvContent: string, timestamp: string, isFrozen: boolean, authorizerRole: Role, authorizerPassword?: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await apiUploadStudentDataFromCsv(csvContent, timestamp, isFrozen, authorizerRole, authorizerPassword || '');
    return { success: result.success || false, message: result.message || 'Upload successful' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Upload failed' };
  }
}

export async function uploadStudentDataFromJsonAction(jsonContent: string, timestamp: string, isFrozen: boolean, authorizerRole: Role, authorizerPassword?: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await apiUploadStudentDataFromJson(jsonContent, timestamp, isFrozen, authorizerRole, authorizerPassword || '');
    return { success: result.success || false, message: result.message || 'Upload successful' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Upload failed' };
  }
}

export async function downloadStudentDataAsCsvAction(): Promise<string> {
  return apiDownloadStudentDataAsCsv();
}

export async function downloadStudentDataAsJsonAction(): Promise<string> {
  return apiDownloadStudentDataAsJson();
}

export async function uploadAttendanceHistoryFromJsonAction(jsonContent: string, timestamp: string, isFrozen: boolean, authorizerRole: Role, authorizerPassword?: string): Promise<{ success: boolean; message: string }> {
  // This endpoint needs to be added to Flask backend
  // For now, return error
  return { success: false, message: 'Not yet implemented in Flask backend' };
}

export async function downloadAttendanceHistoryAsJsonAction(): Promise<string> {
  return apiDownloadAttendanceHistoryAsJson();
}

export async function uploadAttendanceHistoryFromCsvAction(csvContent: string, timestamp: string, isFrozen: boolean, authorizerRole: Role, authorizerPassword?: string): Promise<{ success: boolean; message: string }> {
  // This endpoint needs to be added to Flask backend
  return { success: false, message: 'Not yet implemented in Flask backend' };
}

export async function downloadDetailedAttendanceHistoryAsCsvAction(): Promise<string> {
  return apiDownloadDetailedAttendanceHistoryAsCsv();
}

export async function downloadAttendanceSummaryAsCsvAction(): Promise<string> {
  return apiDownloadAttendanceSummaryAsCsv();
}

export async function downloadStudentAttendanceSummaryAsCsvAction(student: Student): Promise<string> {
  return apiDownloadStudentAttendanceSummaryAsCsv(student);
}

// --- PDF Actions ---

export async function downloadStudentDataAsPdfAction(): Promise<string> {
  return apiDownloadStudentDataAsPdf();
}

export async function downloadAttendanceSummaryAsPdfAction(): Promise<string> {
  return apiDownloadAttendanceSummaryAsPdf();
}

export async function downloadStudentAttendanceSummaryAsPdfAction(student: Student): Promise<string> {
  return apiDownloadStudentAttendanceSummaryAsPdf(student);
}

// --- Delete Actions ---

export async function deleteHistoryAction(): Promise<void> {
  await apiDeleteHistory();
}

export async function deleteAllStudentDataAction(): Promise<void> {
  await apiDeleteAllStudentData();
}

// --- Time Action ---

export async function getCurrentAppTimeAction(): Promise<Date> {
  return apiGetCurrentTime();
}

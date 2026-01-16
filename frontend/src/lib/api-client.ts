/**
 * API client for Flask backend.
 * Replaces Next.js server actions with HTTP requests to Flask.
 */
// Get backend URL - automatically detects hostname for LAN access
function getBackendUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:5000';
  }
  
  // Use environment variable if set
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }
  
  // Automatically detect hostname from current page URL (works for LAN access)
  let hostname = window.location.hostname;
  // Normalize dev host 0.0.0.0 to localhost so browsers can reach it
  if (hostname === '0.0.0.0') {
    hostname = 'localhost';
  }
  return `http://${hostname}:5000`;
}

const BACKEND_URL = getBackendUrl();

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Try to parse JSON error, but handle cases where response might not be JSON
      let errorData: any = { error: `HTTP ${response.status}` };
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          errorData = { error: text || `HTTP ${response.status}: ${response.statusText}` };
        }
      } catch (parseError) {
        // If we can't parse the error, use status text
        errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
    
    return response.json();
  } catch (error: any) {
    // Better error handling for network issues
    if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
      throw new Error(`Cannot connect to backend at ${BACKEND_URL}. Make sure the Flask backend is running on port 5000.`);
    }
    // Re-throw the error if it's already an Error with a message
    if (error instanceof Error) {
      throw error;
    }
    // Otherwise wrap it
    throw new Error(error.message || String(error));
  }
}

// Student operations
export async function getFilteredStudents(filters: {
  date?: string;
  searchQuery?: string | null;
  statusFilter?: string | null;
  gradeFilter?: string | null;
  classFilter?: string | null;
  roleFilter?: string | null;
}) {
  return fetchAPI('/api/get-filtered-students', {
    method: 'POST',
    body: JSON.stringify(filters),
  });
}

export async function getStudentById(studentId: number) {
  return fetchAPI(`/api/get-student-by-id/${studentId}`);
}

export async function saveAttendance(students: any[]) {
  return fetchAPI('/api/save-attendance', {
    method: 'POST',
    body: JSON.stringify(students),
  });
}

export async function addStudent(newStudent: any) {
  return fetchAPI('/api/add-student', {
    method: 'POST',
    body: JSON.stringify(newStudent),
  });
}

export async function removeStudent(studentId: number) {
  return fetchAPI(`/api/remove-student/${studentId}`, {
    method: 'DELETE',
  });
}

export async function updateStudent(studentId: number, updatedDetails: any) {
  return fetchAPI(`/api/update-student/${studentId}`, {
    method: 'PUT',
    body: JSON.stringify(updatedDetails),
  });
}

// Authentication
export async function validatePassword(role: string, password: string) {
  const result = await fetchAPI('/api/validate-password', {
    method: 'POST',
    body: JSON.stringify({ role, password }),
  });
  return result.valid;
}

export async function updatePasswords(passwordsToUpdate: Record<string, string>, authorizerRole: string, authorizerPassword: string) {
  return fetchAPI('/api/update-passwords', {
    method: 'POST',
    body: JSON.stringify({
      passwords: passwordsToUpdate,
      authorizerRole,
      authorizerPassword,
    }),
  });
}

// Time
export async function getCurrentTime() {
  const result = await fetchAPI('/api/get-current-time');
  return new Date(result.time);
}

// Backups
export async function createBackup(dataType: 'students' | 'attendance', timestamp: string, isFrozen: boolean) {
  const result = await fetchAPI('/api/create-backup', {
    method: 'POST',
    body: JSON.stringify({ dataType, timestamp, isFrozen }),
  });
  return result.filename;
}

export async function listBackups() {
  return fetchAPI('/api/list-backups');
}

export async function restoreBackup(dataType: 'students' | 'attendance', filename: string) {
  return fetchAPI('/api/restore-backup', {
    method: 'POST',
    body: JSON.stringify({ dataType, filename }),
  });
}

export async function downloadBackup(dataType: 'students' | 'attendance', filename: string) {
  const result = await fetchAPI('/api/download-backup', {
    method: 'POST',
    body: JSON.stringify({ dataType, filename }),
  });
  return result.content;
}

export async function deleteBackup(dataType: 'students' | 'attendance', filename: string) {
  return fetchAPI('/api/delete-backup', {
    method: 'POST',
    body: JSON.stringify({ dataType, filename }),
  });
}

export async function deleteAllBackups() {
  return fetchAPI('/api/delete-all-backups', {
    method: 'POST',
  });
}

// CSV/JSON exports
export async function downloadStudentDataAsCsv(): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-student-data-csv`);
  return response.text();
}

export async function downloadStudentDataAsJson(): Promise<string> {
  const result = await fetchAPI('/api/download-student-data-json');
  return JSON.stringify(result, null, 2);
}

export async function uploadStudentDataFromCsv(csvContent: string, timestamp: string, isFrozen: boolean, authorizerRole: string, authorizerPassword: string) {
  return fetchAPI('/api/upload-student-data-csv', {
    method: 'POST',
    body: JSON.stringify({ csvContent, timestamp, isFrozen, authorizerRole, authorizerPassword }),
  });
}

export async function uploadStudentDataFromJson(jsonContent: string, timestamp: string, isFrozen: boolean, authorizerRole: string, authorizerPassword: string) {
  return fetchAPI('/api/upload-student-data-json', {
    method: 'POST',
    body: JSON.stringify({ jsonContent, timestamp, isFrozen, authorizerRole, authorizerPassword }),
  });
}

export async function downloadAttendanceHistoryAsJson(): Promise<string> {
  const result = await fetchAPI('/api/download-attendance-history-json');
  return JSON.stringify(result, null, 2);
}

export async function downloadDetailedAttendanceHistoryAsCsv(): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-detailed-attendance-history-csv`);
  return response.text();
}

export async function downloadAttendanceSummaryAsCsv(): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-attendance-summary-csv`);
  return response.text();
}

export async function downloadStudentAttendanceSummaryAsCsv(student: any): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-student-attendance-summary-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: student.id }),
  });
  return response.text();
}

// PDF exports
export async function downloadStudentDataAsPdf(): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-student-data-pdf`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadAttendanceSummaryAsPdf(): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-attendance-summary-pdf`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadStudentAttendanceSummaryAsPdf(student: any): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/download-student-attendance-summary-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: student.id }),
  });
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Logs
export async function getActionLogs() {
  return fetchAPI('/api/get-action-logs');
}

export async function appendToActionLog(timestamp: string, action: string) {
  // Ensure both fields are provided and not empty
  if (!timestamp || !action) {
    console.warn('appendToActionLog: Missing timestamp or action', { timestamp, action });
    return { success: false };
  }
  
  try {
    return await fetchAPI('/api/append-action-log', {
      method: 'POST',
      body: JSON.stringify({ timestamp, action }),
    });
  } catch (error) {
    console.error('Failed to append action log:', error);
    // Don't throw - action logs are not critical
    return { success: false };
  }
}

export async function clearActionLogs(role: string) {
  return fetchAPI('/api/clear-action-logs', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export async function getAuthLogs() {
  return fetchAPI('/api/get-auth-logs');
}

export async function appendToAuthLog(timestamp: string, message: string) {
  return fetchAPI('/api/append-auth-log', {
    method: 'POST',
    body: JSON.stringify({ timestamp, message }),
  });
}

export async function clearAuthLogs(role: string) {
  return fetchAPI('/api/clear-auth-logs', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

// Delete operations
export async function deleteHistory() {
  return fetchAPI('/api/delete-history', {
    method: 'POST',
  });
}

export async function deleteAllStudentData() {
  return fetchAPI('/api/delete-all-student-data', {
    method: 'POST',
  });
}

/**
 * API client for Flask backend.
 * Replaces Next.js server actions with HTTP requests to Flask.
 * Now uses WebSocket for most operations, keeping REST for file downloads/uploads.
 */
import { wsClient } from './websocket-client';

// Get backend URL from Node.js server API endpoint
async function getBackendUrlFromServer(): Promise<string> {
  if (typeof window === 'undefined') {
    return 'http://localhost:5000';
  }
  try {
    const proto = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    const backendUrl = `${proto}//${hostname}:5000`;
    console.debug('Derived backend URL from browser location:', backendUrl);
    return backendUrl;
  } catch (error) {
    console.error('Failed to derive backend URL from window.location:', error);
    return 'http://localhost:5000';
  }
}

let BACKEND_URL: string | null = null;

async function ensureBackendUrl(): Promise<string> {
  if (!BACKEND_URL) {
    BACKEND_URL = await getBackendUrlFromServer();
  }
  return BACKEND_URL;
}

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const backendUrl = await ensureBackendUrl();
  try {
    const response = await fetch(`${backendUrl}${endpoint}`, {
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
          // If server returned an HTML error page (e.g. Flask 500), avoid
          // throwing the entire HTML blob into the UI overlay. Log the body
          // for debugging and provide a concise message instead.
          if (contentType && contentType.includes('text/html')) {
            // Truncate HTML error bodies and log at debug level to avoid
            // flooding the browser console/Next overlay with huge HTML pages.
            const MAX_LOG_CHARS = 1000;
            const snippet = text.length > MAX_LOG_CHARS ? text.slice(0, MAX_LOG_CHARS) + '... [truncated]' : text;
            console.debug('Backend returned HTML error body (truncated):', snippet);
            errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
          } else {
            errorData = { error: text || `HTTP ${response.status}: ${response.statusText}` };
          }
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
    const msg = (error && error.message) ? String(error.message) : '';
    const isNetworkErr = error instanceof TypeError || error?.name === 'TypeError' || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network');
    if (isNetworkErr) {
      throw new Error(`Cannot connect to backend. Make sure the Flask backend is running on port 5000.`);
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
  // Prefer HTTP snapshot fetch for stable data retrieval. Build query params.
  const params = new URLSearchParams();
  if (filters?.date) params.set('date', filters.date);
  if (filters?.searchQuery) params.set('searchQuery', String(filters.searchQuery));
  if (filters?.statusFilter) params.set('statusFilter', String(filters.statusFilter));
  if (filters?.gradeFilter) params.set('gradeFilter', String(filters.gradeFilter));
  if (filters?.classFilter) params.set('classFilter', String(filters.classFilter));
  if (filters?.roleFilter) params.set('roleFilter', String(filters.roleFilter));

  const endpoint = `/api/students?${params.toString()}`;
  const result = await fetchAPI(endpoint);
  return result.students || [];
}

export async function getStudentById(studentId: number) {
  const result = await fetchAPI(`/api/students/${studentId}`);
  return result.student || null;
}

export async function getStudentMonthlyAttendance(studentId: number, month?: string) {
  // month format: YYYY-MM
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const query = params.toString() ? `?${params.toString()}` : '';
  try {
    const result = await fetchAPI(`/api/students/${studentId}/attendance${query}`);
    // New backend returns both `attendanceHistory` and `schoolDays` for month requests.
    return {
      attendanceHistory: result.attendanceHistory || [],
      schoolDays: result.schoolDays || []
    };
  } catch (err) {
    // Fallback: fetch full student record and filter client-side
    try {
      const student = await getStudentById(studentId);
      const hist = (student && student.attendanceHistory) ? student.attendanceHistory : [];
      if (!month) return { attendanceHistory: hist, schoolDays: [] };
      const filtered = hist.filter((r: any) => typeof r.date === 'string' && r.date.startsWith(month));
      // Best-effort fallback: compute schoolDays from weekday presence in history
      const sdSet = new Set<string>();
      for (const r of hist) {
        try {
          if (typeof r.date === 'string') sdSet.add(r.date);
        } catch (e) {}
      }
      return { attendanceHistory: filtered, schoolDays: Array.from(sdSet) };
    } catch (e) {
      throw err;
    }
  }
}

export async function getStudentAttendanceTrend(studentId: number, month: string) {
  // month format: YYYY-MM
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const query = params.toString() ? `?${params.toString()}` : '';
  try {
    const result = await fetchAPI(`/api/students/${studentId}/attendance/trend${query}`);
    // Normalize to { points: [...] }
    return result.points || [];
  } catch (err) {
    // Fallback: build points client-side from monthly attendance records
    try {
      const monthHistResp = await getStudentMonthlyAttendance(studentId, month);
      const monthHist = (monthHistResp && (monthHistResp as any).attendanceHistory) ? (monthHistResp as any).attendanceHistory : [];
      const year = Number(month.split('-')[0]);
      const mon = Number(month.split('-')[1]);
      const daysInMonth = new Date(year, mon, 0).getDate();
      const points: any[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, '0');
        const mm = String(mon).padStart(2, '0');
        const label = `${year}-${mm}-${dd}`;
        const records = (monthHist || []).filter((r: any) => r.date === label);
        let on_time = 0;
        let late = 0;
        let absent = 0;
        let arrival_ts = null;
        let arrival_local = null;
        let arrival_minutes = null;
        if (records.length > 0) {
          for (const r of records) {
            if (r.status === 'on time') on_time += 1;
            else if (r.status === 'late') late += 1;
            if (!arrival_ts && r.checkInTime) {
              try {
                const dObj = new Date(r.checkInTime);
                arrival_ts = Math.floor(dObj.getTime() / 1000);
                arrival_local = dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                arrival_minutes = dObj.getHours() * 60 + dObj.getMinutes();
              } catch (e) {}
            }
          }
          absent = 0;
        } else {
          const dObj = new Date(label + 'T00:00:00');
          const day = dObj.getDay();
          absent = (day > 0 && day < 6) ? 1 : 0;
        }
        points.push({ date: label, on_time, late, absent, arrival_ts, arrival_local, arrival_minutes });
      }
      return points;
    } catch (e) {
      throw err;
    }
  }
}

export async function saveAttendance(arg: any) {
  // Accept an array of students and POST to backend. Do NOT request weekend saves from client.
  const students = Array.isArray(arg) ? arg : (arg && arg.students) ? arg.students : [];
  // Prefer WebSocket RPC for saving attendance so server can immediately
  // broadcast updates to connected clients. Fall back to HTTP if WebSocket
  // is unavailable to preserve reliability in mixed environments.
  try {
    await wsClient.saveAttendance(students);
    return { success: true };
  } catch (err) {
    // If wsClient reports not connected or times out, fall back to HTTP.
    try {
      return await fetchAPI('/api/save-attendance', {
        method: 'POST',
        body: JSON.stringify({ students }),
      });
    } catch (httpErr) {
      throw httpErr;
    }
  }
}

export async function addStudent(studentData: any) {
  return wsClient.addStudent(studentData);
}

export async function removeStudent(studentId: number) {
  return wsClient.removeStudent(studentId);
}

export async function updateStudent(studentId: number, data: any) {
  return wsClient.updateStudent(studentId, data);
}

// Authentication
export async function validatePassword(role: string, password: string) {
  return wsClient.validatePassword(role, password);
}

export async function updatePasswords(passwordsToUpdate: Record<string, string>, authorizerRole: string, authorizerPassword: string) {
  return wsClient.updatePasswords(passwordsToUpdate, authorizerRole, authorizerPassword);
}

export async function getCurrentTime() {
  const timeString = await wsClient.getCurrentTime();
  return new Date(timeString);
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
  return wsClient.listBackups();
}

export async function restoreBackup(dataType: 'students' | 'attendance', filename: string) {
  return wsClient.restoreBackup(dataType, filename);
}

export async function downloadBackup(dataType: 'students' | 'attendance', filename: string, authorizerRole?: string, authorizerPassword?: string) {
  // Downloads a binary sqlite file. Return a Blob of the file.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorizerRole && authorizerPassword) {
    headers['X-Authorizer-Role'] = authorizerRole;
    headers['X-Authorizer-Password'] = authorizerPassword;
  }

  const backendUrl = await ensureBackendUrl();
  const response = await fetch(`${backendUrl}/api/download-backup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dataType, filename }),
  });
  if (!response.ok) {
    let err = 'Download failed';
    try {
      const text = await response.text();
      err = text || err;
    } catch {}
    throw new Error(err);
  }
  const blob = await response.blob();
  return blob;
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
  const backendUrl = await ensureBackendUrl();
  const response = await fetch(`${backendUrl}/api/download-student-data-csv`);
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

export async function getStudentSummary(studentId: number) {
  // Prefer WebSocket RPC but gracefully fall back to HTTP when WS is unavailable.
  try {
    const result = await wsClient.getStudentSummary(studentId);
    return result;
  } catch (wsErr) {
    console.debug('wsClient.getStudentSummary failed, falling back to HTTP:', wsErr);
    // Fallback: fetch single student and full student list via HTTP and compute summary locally
    try {
      const studentResp = await fetchAPI(`/api/students/${studentId}`);
      const allResp = await fetchAPI(`/api/students`);
      const student = studentResp?.student;
      const allStudents = allResp?.students || [];
      if (!student) return { success: false, message: 'Student not found (HTTP fallback)' };

      // Lazy-import the client-side summary calculator to avoid circular imports at module load
      const utils = await import('./utils');
      const summary = utils.getAttendanceSummary(student as any, allStudents as any[]);
      return { success: true, studentId, summary };
    } catch (httpErr) {
      console.error('getStudentSummary HTTP fallback failed:', httpErr);
      throw httpErr;
    }
  }
}

export async function getAllStudentsSummaries() {
  return wsClient.getAllStudentsSummaries();
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
  return wsClient.getActionLogs();
}

export async function appendToActionLog(timestamp: string, action: string) {
  // Ensure both fields are provided and not empty
  if (!timestamp || !action) {
    console.warn('appendToActionLog: Missing timestamp or action', { timestamp, action });
    return { success: false };
  }
  
  try {
    await wsClient.appendActionLog(timestamp, action);
    return { success: true };
  } catch (error) {
    console.error('Failed to append action log:', error);
    // Don't throw - action logs are not critical
    return { success: false };
  }
}

export async function clearActionLogs(role: string) {
  return wsClient.clearActionLogs(role);
}

export async function getAuthLogs() {
  return wsClient.getAuthLogs();
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

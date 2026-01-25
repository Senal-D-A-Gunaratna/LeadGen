/**
 * WebSocket client for real-time communication with Flask backend.
 * Replaces long-polling with WebSocket connections.
 */
import { io, Socket } from 'socket.io-client';

// Get backend URL from Node.js server API endpoint
async function getBackendUrlFromServer(): Promise<string> {
  if (typeof window === 'undefined') {
    return 'http://localhost:5000';
  }
  
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`API config request failed: ${response.status}`);
    }
    const data = await response.json();
    const backendUrl = data.backendURL;
    console.debug('Backend URL from server:', backendUrl);
    return backendUrl;
  } catch (error) {
    console.error('Failed to fetch backend URL from server:', error);
    // Fallback to localhost
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

class WebSocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private authenticated: boolean = false;
  private currentRole: string | null = null;
  private connected: boolean = false;
  private connecting: boolean = false;

  private emitConnectionState(connected: boolean) {
    this.connected = connected;
    const listeners = this.listeners.get('connection') || new Set();
    listeners.forEach((listener) => {
      try {
        listener(connected);
      } catch (e) {
        console.error('connection listener error', e);
      }
    });
  }

  private waitForConnected(timeoutMs: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      // Already connected
      if (this.socket && this.socket.connected) {
        resolve(true);
        return;
      }

      // Ensure socket is created / trying to connect
      this.connect();

      const onConnect = () => {
        try { this.socket?.off('connect', onConnect); } catch (e) {}
        clearTimeout(timer);
        resolve(true);
      };

      // Fallback timeout
      const timer = setTimeout(() => {
        try { this.socket?.off('connect', onConnect); } catch (e) {}
        resolve(false);
      }, timeoutMs);

      try {
        this.socket?.on('connect', onConnect);
      } catch (e) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  connect() {
    if (this.socket?.connected || this.connecting) {
      return;
    }

    // If there is an existing socket that isn't connected, make sure it's
    // fully cleaned up before creating a new one to avoid duplicate listeners
    // or leaked sockets that still attempt reconnection.
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
      } catch (e) {}
      try {
        this.socket.disconnect();
      } catch (e) {}
      this.socket = null;
    }

    // Ensure backend URL is fetched from server before connecting
    ensureBackendUrl().then((backendUrl) => {
      // Build options separately and cast to `any` because the socket.io-client
      // TypeScript definitions don't include some underlying engine.io options
      // (like `pingTimeout`/`pingInterval`) even though they work at runtime.
      const socketOptions: any = {
        transports: ['websocket', 'polling'],
        // Enable automatic reconnection with sensible backoff
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5,
        // Keepalive settings (ms)
        pingTimeout: 60000,
        pingInterval: 25000,
      };

      this.connecting = true;
      this.socket = io(backendUrl, socketOptions);

      this.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.connecting = false;
        this.emitConnectionState(true);
      });

      this.socket.on('disconnect', (reason: any) => {
        console.log('WebSocket disconnected', reason);
        this.connecting = false;
        this.authenticated = false;
        this.currentRole = null;
        this.emitConnectionState(false);
      });

      // Treat connection errors as server error / disconnected state
      this.socket.on('connect_error', (err: any) => {
        console.error('WebSocket connect error', err);
        this.connecting = false;
        this.emitConnectionState(false);
      });

      // Reconnection lifecycle: mark as disconnected while attempting
      this.socket.on('reconnect_attempt', (attempt: number) => {
        console.log('WebSocket reconnect attempt', attempt);
        this.emitConnectionState(false);
      });

      this.socket.on('reconnect', (attempt: number) => {
        console.log('WebSocket reconnected after', attempt, 'attempts');
        this.emitConnectionState(true);
      });

      this.socket.on('reconnect_failed', () => {
        console.warn('WebSocket reconnect failed');
        this.connecting = false;
        this.emitConnectionState(false);
      });

      this.socket.on('auth_response', (data: { success: boolean; role?: string; message: string }) => {
        if (data.success) {
          this.authenticated = true;
          this.currentRole = data.role || null;
        }
      });

      this.socket.on('data_changed', (data: { type: string; data: any }) => {
        // Broadcast to all listeners
        const listeners = this.listeners.get('data_changed') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('summary_update', (data: { summaries: any[] }) => {
        // Broadcast to all listeners
        const listeners = this.listeners.get('summary_update') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('connection_count', (data: { total: number; authenticated: number }) => {
        const listeners = this.listeners.get('connection_count') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('scan_response', (data: { success: boolean; student?: any; message?: string }) => {
        const listeners = this.listeners.get('scan_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('filtered_students_response', (data: { success: boolean; students?: any[]; message?: string }) => {
        const listeners = this.listeners.get('filtered_students_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('student_by_id_response', (data: { success: boolean; student?: any; message?: string }) => {
        const listeners = this.listeners.get('student_by_id_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('save_attendance_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('save_attendance_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('add_student_response', (data: { success: boolean; student?: any; message?: string }) => {
        const listeners = this.listeners.get('add_student_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('remove_student_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('remove_student_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('update_student_response', (data: { success: boolean; student?: any; message?: string }) => {
        const listeners = this.listeners.get('update_student_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('validate_password_response', (data: { valid: boolean }) => {
        const listeners = this.listeners.get('validate_password_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('update_passwords_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('update_passwords_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('current_time_response', (data: { time: string }) => {
        const listeners = this.listeners.get('current_time_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('list_backups_response', (data: { success: boolean; students?: string[]; attendance?: string[]; message?: string }) => {
        const listeners = this.listeners.get('list_backups_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('restore_backup_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('restore_backup_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('get_action_logs_response', (data: { success: boolean; logs?: any[]; message?: string }) => {
        const listeners = this.listeners.get('get_action_logs_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('get_student_summary_response', (data: { success: boolean; studentId?: number; summary?: any; message?: string }) => {
        const listeners = this.listeners.get('get_student_summary_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('get_all_students_summaries_response', (data: { success: boolean; summaries?: any[]; message?: string }) => {
        const listeners = this.listeners.get('get_all_students_summaries_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('append_action_log_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('append_action_log_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('clear_action_logs_response', (data: { success: boolean; message?: string }) => {
        const listeners = this.listeners.get('clear_action_logs_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      this.socket.on('get_auth_logs_response', (data: { success: boolean; logs?: any[]; message?: string }) => {
        const listeners = this.listeners.get('get_auth_logs_response') || new Set();
        listeners.forEach(listener => listener(data));
      });

      // Attendance trend push (broadcast from server when trend for a student/month is available)
      this.socket.on('attendance_trend', (data: { success: boolean; studentId?: number; year?: number; month?: number; points?: any[]; message?: string }) => {
        console.debug('wsClient: attendance_trend push received', data);
        const listeners = this.listeners.get('attendance_trend') || new Set();
        listeners.forEach(listener => listener(data));
      });

      // Note: push-based 'static_filters_update' removed — use request API instead.
    }).catch((error) => {
      console.error('Failed to get backend URL:', error);
      this.emitConnectionState(false);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.authenticated = false;
      this.currentRole = null;
      this.emitConnectionState(false);
    }
  }

  getStaticFilters(): Promise<{ grades: string[]; classes: string[]; roles: string[] }> {
    return new Promise(async (resolve, reject) => {
      const ok = await this.waitForConnected(5000);
      if (!ok || !this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; grades?: string[]; classes?: string[]; roles?: string[]; message?: string }) => {
        this.socket?.off('get_static_filters_response', handler);
        if (data.success) {
          resolve({ grades: data.grades || [], classes: data.classes || [], roles: data.roles || [] });
        } else {
          reject(new Error(data.message || 'Failed to get static filters'));
        }
      };

      this.socket.on('get_static_filters_response', handler);
      this.socket.emit('get_static_filters');

      setTimeout(() => {
        this.socket?.off('get_static_filters_response', handler);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  authenticate(role: string, password: string): Promise<boolean> {
    console.log('Attempting to authenticate', role);
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        console.log('Socket not connected, connecting...');
        this.connect();
        // Wait for the 'connect' event before proceeding to authenticate
        const connectHandler = () => {
          console.log('Socket connected, proceeding to authenticate');
          this.socket?.off('connect', connectHandler);
          // Now that connected, recursively call authenticate
          this.authenticate(role, password).then(resolve);
        };
        this.socket?.on('connect', connectHandler);
        // Timeout if connection takes too long
        setTimeout(() => {
          console.log('Connection timeout');
          this.socket?.off('connect', connectHandler);
          resolve(false);
        }, 5000);
        return;
      }

      console.log('Socket connected, sending authenticate event');
      const handler = (data: { success: boolean; role?: string; message: string }) => {
        console.log('Auth response received', data);
        this.socket?.off('auth_response', handler);
        if (data.success) {
          this.authenticated = true;
          this.currentRole = data.role || null;
          resolve(true);
        } else {
          resolve(false);
        }
      };

      this.socket.on('auth_response', handler);
      this.socket.emit('authenticate', { role, password });

      // Timeout after 15 seconds
      setTimeout(() => {
        console.log('Auth response timeout');
        this.socket?.off('auth_response', handler);
        resolve(false);
      }, 15000);
    });
  }

  scanStudent(fingerprint: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; student?: any; message?: string }) => {
        this.socket?.off('scan_response', handler);
        if (data.success) {
          resolve(data.student);
        } else {
          reject(new Error(data.message || 'Scan failed'));
        }
      };

      this.socket.on('scan_response', handler);
      this.socket.emit('scan_student', { fingerprint });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.off('scan_response', handler);
        reject(new Error('Scan timeout'));
      }, 10000);
    });
  }

  getFilteredStudents(filters: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.getFilteredStudents(filters).then(resolve).catch(reject);
        }, 1000);
        return;
      }

      const handler = (data: { success: boolean; students?: any[]; message?: string }) => {
        this.socket?.off('filtered_students_response', handler);
        if (data.success) {
          resolve(data.students || []);
        } else {
          reject(new Error(data.message || 'Failed to get students'));
        }
      };

      this.socket.on('filtered_students_response', handler);
      this.socket.emit('get_filtered_students', filters);

      setTimeout(() => {
        this.socket?.off('filtered_students_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getStudentById(studentId: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; student?: any; message?: string }) => {
        this.socket?.off('student_by_id_response', handler);
        if (data.success) {
          resolve(data.student);
        } else {
          reject(new Error(data.message || 'Student not found'));
        }
      };

      this.socket.on('student_by_id_response', handler);
      this.socket.emit('get_student_by_id', { studentId });

      setTimeout(() => {
        this.socket?.off('student_by_id_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  saveAttendance(students: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('save_attendance_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to save attendance'));
        }
      };

      this.socket.on('save_attendance_response', handler);
      this.socket.emit('save_attendance', { students });

      setTimeout(() => {
        this.socket?.off('save_attendance_response', handler);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  addStudent(studentData: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; student?: any; message?: string }) => {
        this.socket?.off('add_student_response', handler);
        if (data.success) {
          resolve(data.student);
        } else {
          reject(new Error(data.message || 'Failed to add student'));
        }
      };

      this.socket.on('add_student_response', handler);
      this.socket.emit('add_student', studentData);

      setTimeout(() => {
        this.socket?.off('add_student_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  removeStudent(studentId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('remove_student_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to remove student'));
        }
      };

      this.socket.on('remove_student_response', handler);
      this.socket.emit('remove_student', { studentId });

      setTimeout(() => {
        this.socket?.off('remove_student_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  updateStudent(studentId: number, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; student?: any; message?: string }) => {
        this.socket?.off('update_student_response', handler);
        if (data.success) {
          resolve(data.student);
        } else {
          reject(new Error(data.message || 'Failed to update student'));
        }
      };

      this.socket.on('update_student_response', handler);
      this.socket.emit('update_student', { studentId, data });

      setTimeout(() => {
        this.socket?.off('update_student_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  validatePassword(role: string, password: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        // Attempt to connect first, then validate once connected
        this.connect();

        const connectHandler = () => {
          this.socket?.off('connect', connectHandler);
          // After connected, call validatePassword again
          this.validatePassword(role, password).then(resolve);
        };

        this.socket?.on('connect', connectHandler);

        // Timeout if connection takes too long
        setTimeout(() => {
          this.socket?.off('connect', connectHandler);
          resolve(false);
        }, 5000);

        return;
      }

      const handler = (data: { valid: boolean }) => {
        this.socket?.off('validate_password_response', handler);
        resolve(data.valid);
      };

      this.socket.on('validate_password_response', handler);
      this.socket.emit('validate_password', { role, password });

      setTimeout(() => {
        this.socket?.off('validate_password_response', handler);
        resolve(false);
      }, 15000);
    });
  }

  updatePasswords(passwords: Record<string, string>, authorizerRole: string, authorizerPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('update_passwords_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to update passwords'));
        }
      };

      this.socket.on('update_passwords_response', handler);
      this.socket.emit('update_passwords', { passwords, authorizerRole, authorizerPassword });

      setTimeout(() => {
        this.socket?.off('update_passwords_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getCurrentTime(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.getCurrentTime().then(resolve).catch(reject);
        }, 1000);
        return;
      }

      const handler = (data: { time: string }) => {
        this.socket?.off('current_time_response', handler);
        resolve(data.time);
      };

      this.socket.on('current_time_response', handler);
      this.socket.emit('get_current_time');

      setTimeout(() => {
        this.socket?.off('current_time_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  listBackups(): Promise<{ students: string[]; attendance: string[] }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; students?: string[]; attendance?: string[]; message?: string }) => {
        this.socket?.off('list_backups_response', handler);
        if (data.success) {
          resolve({ students: data.students || [], attendance: data.attendance || [] });
        } else {
          reject(new Error(data.message || 'Failed to list backups'));
        }
      };

      this.socket.on('list_backups_response', handler);
      this.socket.emit('list_backups');

      setTimeout(() => {
        this.socket?.off('list_backups_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  restoreBackup(dataType: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('restore_backup_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to restore backup'));
        }
      };

      this.socket.on('restore_backup_response', handler);
      this.socket.emit('restore_backup', { dataType, filename });

      setTimeout(() => {
        this.socket?.off('restore_backup_response', handler);
        reject(new Error('Request timeout'));
      }, 30000); // Longer timeout for restore
    });
  }

  getActionLogs(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.getActionLogs().then(resolve).catch(reject);
        }, 1000);
        return;
      }

      const handler = (data: { success: boolean; logs?: any[]; message?: string }) => {
        this.socket?.off('get_action_logs_response', handler);
        if (data.success) {
          resolve(data.logs || []);
        } else {
          // Treat 'Not authenticated' as empty logs instead of an error
          if (data.message && data.message.toLowerCase().includes('not authenticated')) {
            resolve([]);
          } else {
            reject(new Error(data.message || 'Failed to get logs'));
          }
        }
      };

      this.socket.on('get_action_logs_response', handler);
      this.socket.emit('get_action_logs');

      setTimeout(() => {
        this.socket?.off('get_action_logs_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getStudentSummary(studentId: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; studentId?: number; summary?: any; message?: string }) => {
        this.socket?.off('get_student_summary_response', handler);
        if (data.success) {
          resolve({ studentId: data.studentId, summary: data.summary });
        } else {
          reject(new Error(data.message || 'Failed to get summary'));
        }
      };

      this.socket.on('get_student_summary_response', handler);
      this.socket.emit('get_student_summary', { studentId });

      setTimeout(() => {
        this.socket?.off('get_student_summary_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getAllStudentsSummaries(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.getAllStudentsSummaries().then(resolve).catch(reject);
        }, 1000);
        return;
      }

      const handler = (data: { success: boolean; summaries?: any[]; message?: string }) => {
        this.socket?.off('get_all_students_summaries_response', handler);
        if (data.success) {
          resolve(data.summaries || []);
        } else {
          reject(new Error(data.message || 'Failed to get summaries'));
        }
      };

      this.socket.on('get_all_students_summaries_response', handler);
      this.socket.emit('get_all_students_summaries');

      setTimeout(() => {
        this.socket?.off('get_all_students_summaries_response', handler);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  async getAttendanceAggregate(range: string, grade: string = 'all', status: string = 'overview'): Promise<any> {
    // Ensure connected (wait briefly if necessary)
    const ok = await this.waitForConnected(5000);
    if (!ok || !this.socket || !this.socket.connected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const handler = (data: { success: boolean; range?: string; grade?: string; status?: string; points?: any[]; message?: string }) => {
        const sock = this.socket!;
        sock.off('attendance_aggregate_response', handler);
        if (data.success) {
          resolve({ range: data.range, grade: data.grade, status: data.status, points: data.points || [] });
        } else {
          reject(new Error(data.message || 'Failed to get aggregate'));
        }
      };

      const sock = this.socket!;
      sock.on('attendance_aggregate_response', handler);
      sock.emit('request_attendance_aggregate', { range, grade, status });

      setTimeout(() => {
        this.socket?.off('attendance_aggregate_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getStudentAttendanceTrend(studentId: number, year: number, month: number): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const ok = await this.waitForConnected(10000);
      if (!ok || !this.socket || !this.socket.connected) {
        console.debug('wsClient.getStudentAttendanceTrend: socket not connected');
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; studentId?: number; year?: number; month?: number; points?: any[]; message?: string }) => {
        this.socket?.off('attendance_trend_response', handler);
        console.debug('wsClient.getStudentAttendanceTrend: received response', data);
        if (data.success) {
          resolve({ studentId: data.studentId, year: data.year, month: data.month, points: data.points || [] });
        } else {
          reject(new Error(data.message || 'Failed to get attendance trend'));
        }
      };

      this.socket.on('attendance_trend_response', handler);
      console.debug('wsClient.getStudentAttendanceTrend: emitting request_attendance_trend', { studentId, year, month });
      this.socket.emit('request_attendance_trend', { studentId, year, month });

      setTimeout(() => {
        this.socket?.off('attendance_trend_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  appendActionLog(timestamp: string, action: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('append_action_log_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to append log'));
        }
      };

      this.socket.on('append_action_log_response', handler);
      this.socket.emit('append_action_log', { timestamp, action });

      setTimeout(() => {
        this.socket?.off('append_action_log_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  clearActionLogs(role: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; message?: string }) => {
        this.socket?.off('clear_action_logs_response', handler);
        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.message || 'Failed to clear logs'));
        }
      };

      this.socket.on('clear_action_logs_response', handler);
      this.socket.emit('clear_action_logs', { role });

      setTimeout(() => {
        this.socket?.off('clear_action_logs_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  getAuthLogs(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.getAuthLogs().then(resolve).catch(reject);
        }, 1000);
        return;
      }

      const handler = (data: { success: boolean; logs?: any[]; message?: string }) => {
        this.socket?.off('get_auth_logs_response', handler);
        if (data.success) {
          resolve(data.logs || []);
        } else {
          // Treat 'Not authenticated' as empty logs instead of an error
          if (data.message && data.message.toLowerCase().includes('not authenticated')) {
            resolve([]);
          } else {
            reject(new Error(data.message || 'Failed to get logs'));
          }
        }
      };

      this.socket.on('get_auth_logs_response', handler);
      this.socket.emit('get_auth_logs');

      setTimeout(() => {
        this.socket?.off('get_auth_logs_response', handler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getCurrentRole(): string | null {
    return this.currentRole;
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();

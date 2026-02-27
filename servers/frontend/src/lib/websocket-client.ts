/**
 * Long-polling client that provides a compatible interface to the rest of the
 * frontend. This file intentionally avoids importing `api-client` to prevent
 * circular imports. It uses simple `fetch` calls to the backend HTTP endpoints
 * (long-poll `/api/events/poll`, `/api/scan`, `/api/save-attendance`, etc.).
 */

type EventCallback = (data: any) => void;

class WebSocketClient {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private polling = false;
  private lastId = 0;
  private connected = false;
  private pollController: AbortController | null = null;

  connect() {
    if (this.polling) return;
    this.polling = true;
    this.connected = true;
    this.startPolling();
  }

  disconnect() {
    this.polling = false;
    this.connected = false;
    if (this.pollController) {
      try { this.pollController.abort(); } catch (e) {}
      this.pollController = null;
    }
  }

  isAuthenticated(): boolean {
    return false; // authentication is handled via HTTP auth endpoints
  }

  getCurrentRole(): string | null {
    return null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  on(event: string, cb: EventCallback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: EventCallback) {
    const s = this.listeners.get(event);
    if (s) s.delete(cb);
  }

  private dispatch(event: string, data: any) {
    const s = this.listeners.get(event);
    if (s) {
      for (const cb of Array.from(s)) {
        try { cb(data); } catch (e) { console.error('wsClient listener error', e); }
      }
    }
  }

  private async startPolling() {
    while (this.polling) {
      try {
        this.pollController = new AbortController();
        const signal = this.pollController.signal;
        const resp = await fetch(`/api/events/poll?since=${this.lastId}&timeout=25`, { credentials: 'same-origin', signal });
        if (!resp.ok) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        const body = await resp.json();
        if (body && body.success && Array.isArray(body.events)) {
          for (const ev of body.events) {
            try {
              this.lastId = Math.max(this.lastId, ev.id || 0);
              if (ev.type) this.dispatch(ev.type, ev.data);
            } catch (e) {
              console.error('wsClient: error handling event', e);
            }
          }
        }
      } catch (e) {
        if ((e as any)?.name === 'AbortError') {
          // normal during disconnect
        } else {
          console.debug('wsClient.poll error', e);
          await new Promise(r => setTimeout(r, 1000));
        }
      } finally {
        this.pollController = null;
      }
    }
  }

  async waitForConnected(timeoutMs: number): Promise<boolean> {
    if (this.connected) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.connected) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  // --- High-level operations implemented over HTTP ---

  async getStaticFilters(): Promise<any> {
    const r = await fetch('/api/static-filters', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Failed to fetch static filters');
    return await r.json();
  }

  async scanStudent(fingerprint: string, scannerToken?: string) {
    const body: any = { fingerprint };
    if (scannerToken) body.scanner_token = scannerToken;
    const r = await fetch('/api/scan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Scan request failed');
    return await r.json();
  }

  async saveAttendance(students: any[]) {
    const r = await fetch('/api/save-attendance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ students }) });
    if (!r.ok) throw new Error('Save attendance failed');
    return await r.json();
  }

  async addStudent(studentData: any) {
    const r = await fetch('/api/add-student', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(studentData) });
    if (!r.ok) throw new Error('Add student failed');
    return await r.json();
  }

  async removeStudent(studentId: number) {
    const r = await fetch('/api/remove-student', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId }) });
    if (!r.ok) throw new Error('Remove student failed');
    return await r.json();
  }

  async updateStudent(studentId: number, data: any) {
    const r = await fetch('/api/update-student', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId, data }) });
    if (!r.ok) throw new Error('Update student failed');
    return await r.json();
  }

  async updatePasswords(passwords: Record<string, string>, authorizerRole: string, authorizerPassword: string) {
    const r = await fetch('/api/update-passwords', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passwords, authorizerRole, authorizerPassword }) });
    if (!r.ok) throw new Error('Update passwords failed');
    return await r.json();
  }

  async listBackups() {
    const r = await fetch('/api/list-backups', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('List backups failed');
    return await r.json();
  }

  async restoreBackup(dataType: string, filename: string) {
    const r = await fetch('/api/restore-backup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataType, filename }) });
    if (!r.ok) throw new Error('Restore backup failed');
    return await r.json();
  }

  async listActionLogs() {
    return [] as any[];
  }

  async getActionLogs() {
    try {
      const r = await fetch('/api/action-logs', { credentials: 'same-origin' });
      if (!r.ok) return [];
      const body = await r.json();
      return body.logs || [];
    } catch (e) {
      return [];
    }
  }

  async appendActionLog(timestamp: string, action: string) {
    const r = await fetch('/api/append-action-log', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamp, action }) });
    if (!r.ok) throw new Error('Append action log failed');
    return await r.json();
  }

  async clearActionLogs(role: string) {
    const r = await fetch('/api/clear-action-logs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    if (!r.ok) throw new Error('Clear action logs failed');
    return await r.json();
  }

  async getAuthLogs() {
    try {
      const r = await fetch('/api/auth-logs', { credentials: 'same-origin' });
      if (!r.ok) return [];
      const body = await r.json();
      return body.logs || [];
    } catch (e) {
      return [];
    }
  }

  async getAllStudentsSummaries() {
    try {
      const r = await fetch('/api/students', { credentials: 'same-origin' });
      if (!r.ok) return [];
      const body = await r.json();
      // Backend returns { students: [...] }
      const students = body.students || [];
      // Map to minimal summaries structure expected by callers.
      return students.map((s: any) => ({ studentId: s.student_id, name: s.name, grade: s.grade, className: s.className, summary: s.summary || {} }));
    } catch (e) {
      return [];
    }
  }

  async authenticate(role: string, password: string) {
    const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, password }) });
    if (!r.ok) return { success: false };
    return await r.json();
  }

  async getCurrentTime(): Promise<string> {
    try {
      const r = await fetch('/api/health', { credentials: 'same-origin' });
      if (r.ok) {
        return new Date().toISOString();
      }
    } catch (e) {}
    return new Date().toISOString();
  }
}

export const wsClient = new WebSocketClient();

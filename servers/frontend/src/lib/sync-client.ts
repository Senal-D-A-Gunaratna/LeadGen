import { apiClient } from './api-client';
import * as api from './api-client';

type Listener = (event: string, payload?: any) => void;

class SyncClient {
  private listeners: Set<Listener> = new Set();

  on(listener: Listener) {
    this.listeners.add(listener);
  }

  off(listener: Listener) {
    this.listeners.delete(listener);
  }

  emit(event: string, payload?: any) {
    try { console.debug('sync-client.emit', event, payload); } catch (e) {}
    this.listeners.forEach((l) => {
      try { l(event, payload); } catch (e) { console.error('sync-client listener error', e); }
    });
  }

  start() {
    try {
      // Ensure wsClient starts connecting (no-op if already connected)
      try { (apiClient as any).connect && (apiClient as any).connect(); } catch (err) {}
      apiClient.on('data_changed', this.handleDataChanged);
    } catch (e) { console.debug('sync-client.start bind data_changed failed', e); }
    try { apiClient.on('summary_update', this.handleSummaryUpdate); } catch (e) { console.debug('sync-client.start bind summary_update failed', e); }
    try { apiClient.on('attendance_trend', this.handleAttendanceTrend); } catch (e) { console.debug('sync-client.start bind attendance_trend failed', e); }
  }

  stop() {
    try { apiClient.off('data_changed', this.handleDataChanged); } catch (e) {}
    try { apiClient.off('summary_update', this.handleSummaryUpdate); } catch (e) {}
    try { apiClient.off('attendance_trend', this.handleAttendanceTrend); } catch (e) {}
  }

  private handleAttendanceTrend = (payload: any) => {
    try {
      // Forward attendance_trend payload to listeners; do not treat as authoritative.
      this.emit('attendance_trend', payload);
    } catch (e) {
      console.error('sync-client.handleAttendanceTrend error', e);
    }
  };

  private handleSummaryUpdate = (data: any) => {
    // Re-emit as higher-level event and provide summaries
    this.emit('summary_update', data);
  };

  private handleDataChanged = async (payload: any) => {
    try {
      const type = payload?.type || null;
      const data = payload?.data || {};
      // Emit raw data_changed for callers that want to inspect themselves
      this.emit('data_changed', payload);

      if (!type) return;

      // Map backend event types to HTTP refreshes
      if (type === 'attendance_db_changed') {
        // Full attendance DB changed: refresh all summaries (HTTP/WS fallback)
        try {
          const summaries = await api.getAllStudentsSummaries();
          this.emit('all_summaries', summaries);
        } catch (e) {
          console.debug('sync-client: getAllStudentsSummaries failed', e);
        }
      }

      if (type === 'attendance_updated') {
        const affectedIds: number[] = data?.affectedIds || [];
        if (affectedIds && affectedIds.length > 0) {
          for (const id of affectedIds) {
            try {
              const summary = await api.getStudentSummary(id);
              this.emit('student_summary', { studentId: id, summary });
            } catch (e) {
              console.debug('sync-client: getStudentSummary failed for', id, e);
            }
          }
        }
        this.emit('attendance_updated', { affectedIds });
      }

      if (type === 'student_added' || type === 'student_removed' || type === 'student_updated') {
        // Refresh filtered students list (roster) via HTTP snapshot
        try {
          const today = (new Date()).toISOString().slice(0,10);
          const students = await api.getFilteredStudents({ date: today });
          this.emit('students_refreshed', { students, type, data });
        } catch (e) {
          console.debug('sync-client: getFilteredStudents failed', e);
        }

        // If single student id provided, refresh their summary
        const sid = data?.studentId || data?.studentId;
        if (sid) {
          try {
            const summary = await api.getStudentSummary(sid);
            this.emit('student_summary', { studentId: sid, summary });
          } catch (e) {
            console.debug('sync-client: student summary refresh failed', e);
          }
        }
      }

      // Generic case: if payload contains affectedIds, warm per-student summary cache
      if (data?.affectedIds && Array.isArray(data.affectedIds)) {
        for (const id of data.affectedIds) {
          try {
            const summary = await api.getStudentSummary(id);
            this.emit('student_summary', { studentId: id, summary });
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('sync-client.handleDataChanged error', e);
    }
  };
}

export const syncClient = new SyncClient();
// Auto-start only in browser to avoid SSR side-effects
if (typeof window !== 'undefined') {
  try { syncClient.start(); } catch (e) { console.debug('sync-client auto-start failed', e); }
}

export default syncClient;

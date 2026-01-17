
import { create } from 'zustand';
import { getAuthLogsAction, appendToAuthLogAction, clearAuthLogsAction } from '@/app/actions';
import { useAuthStore } from './use-auth-store';

export interface LogEntry {
  timestamp: Date;
  message: string;
}

interface LogState {
  logs: LogEntry[];
  isInitialized: boolean;
  initialize: () => Promise<void>;
  addLog: (message: string) => Promise<void>;
  clearLogs: () => Promise<void>;
}

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  isInitialized: false,
  initialize: async () => {
    if (get().isInitialized) return;
    try {
      const logs = await getAuthLogsAction();
      const parsedLogs = logs.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
      set({ logs: parsedLogs, isInitialized: true });
    } catch (error) {
      console.error("Failed to initialize auth logs:", error);
      set({ isInitialized: true });
    }
  },
  addLog: async (message) => {
    const newLogEntry: LogEntry = { timestamp: new Date(), message };
    set((state) => ({
      logs: [newLogEntry, ...state.logs].slice(0, 200),
    }));
    await appendToAuthLogAction(newLogEntry);
  },
  clearLogs: async () => {
    const { user } = useAuthStore.getState();
    set({ logs: [] });
    // Only call clearAuthLogsAction when we have a valid role (admin/moderator/dev)
    if (user?.role) {
      await clearAuthLogsAction(user.role);
    }
  },
}));

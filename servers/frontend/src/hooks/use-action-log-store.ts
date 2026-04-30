
import { create } from 'zustand';
import { getActionLogsAction, appendToActionLogAction, clearActionLogsAction } from '@/app/actions';
import { useAuthStore } from './use-auth-store';

export interface ActionLogEntry {
  timestamp: Date;
  message: string;
}

interface ActionLogState {
  actionLogs: ActionLogEntry[];
  isInitialized: boolean;
  initialize: () => Promise<void>;
  addActionLog: (message: string) => Promise<void>;
  clearActionLogs: () => Promise<void>;
}

export const useActionLogStore = create<ActionLogState>((set, get) => ({
  actionLogs: [],
  isInitialized: false,
  initialize: async () => {
    if (get().isInitialized) return;
    try {
      const logs = await getActionLogsAction();
      // Dates from JSON are strings, so we need to convert them back
      const parsedLogs = logs.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
      set({ actionLogs: parsedLogs, isInitialized: true });
    } catch (error) {
      console.error("Failed to initialize action logs:", error);
      set({ isInitialized: true }); // Mark as initialized even on error
    }
  },
  addActionLog: async (message) => {
    const newLogEntry: ActionLogEntry = { timestamp: new Date(), message };
    set((state) => ({
      actionLogs: [newLogEntry, ...state.actionLogs].slice(0, 200),
    }));
    await appendToActionLogAction(newLogEntry);
  },
  clearActionLogs: async () => {
    const { user } = useAuthStore.getState();
    const role = user?.role || 'guest';
    set({ actionLogs: [] });
    await clearActionLogsAction(role);
  },
}));

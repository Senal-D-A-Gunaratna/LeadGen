
import { create } from 'zustand';
import { updatePasswordsAction, validatePasswordAction } from '@/app/actions';
import { useStudentStore } from './use-student-store';
import { useLogStore } from './use-log-store';
import { useActionLogStore } from './use-action-log-store';
import { useUIStateStore } from './use-ui-state-store';

export type Role = 'admin' | 'moderator' | 'dev';

interface User {
  role: Role;
  token?: string;
}

interface AuthState {
  user: User | null;
  isInitialized: boolean;
  isDevUnlocked: boolean; 
  initializeAuth: () => void;
  login: (role: Role, token?: string) => void;
  logout: () => void;
  changePasswordForRole: (role: Role, newPassword: string, authorizerRole: Role, authorizerPassword?: string) => Promise<void>;
  unlockDevMode: (password: string) => Promise<boolean>; 
  lockDevMode: () => void; 
}

const AUTH_SESSION_KEY = 'leadgen:auth';

function loadUserFromSession(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.role) return null;
    return { role: parsed.role, token: parsed.token };
  } catch (e) {
    return null;
  }
}

function saveUserToSession(user: User | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!user) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
  } catch (e) {
    // Ignore storage errors
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
    user: null,
    isInitialized: false,
    isDevUnlocked: false, // Default to locked
    initializeAuth: () => {
        // Prevent re-initialization
        if (get().isInitialized) return;
        set({ isInitialized: true });

        // Recover any existing authenticated session from this browser tab.
        const existing = loadUserFromSession();
        if (existing) {
          set({ user: existing });
        }
    },
    login: (role, token?) => {
        const { addLog } = useLogStore.getState();
        addLog(`User signed in as: ${role}`);
        const user = { role, token };
        set({ user });
        saveUserToSession(user);
        // After login, re-run initialization for admin-only stores so they
        // fetch protected data (auth/action logs) without requiring a page reload.
        try {
            useLogStore.getState().initialize();
            useActionLogStore.getState().initialize();
        } catch (e) {
            // Non-fatal: if initialization fails, the UI remains usable.
            console.error('Failed to initialize admin stores after login:', e);
        }
    },
    logout: () => {
        const { user } = get();
        const { addLog } = useLogStore.getState();
        const { setActiveTab } = useUIStateStore.getState();

        if (user) {
            addLog(`User signed out from role: ${user.role}`);
        }

        // Always lock dev mode on any logout
        get().lockDevMode();
        
        // If the user logging out is a dev, also reset the time freeze.
        if (user?.role === 'dev') {
            useStudentStore.getState().actions.setFakeDate(null);
        }
        set({ user: null });
        saveUserToSession(null);
        setActiveTab('dashboard'); // Reset the active tab
    },
    changePasswordForRole: async (role, newPassword, authorizerRole, authorizerPassword) => {
        const passwordsToUpdate: Partial<Record<Role, string>> = { [role]: newPassword };
        await updatePasswordsAction(passwordsToUpdate as Record<Role, string>, authorizerRole, authorizerPassword);
    },
    unlockDevMode: async (password) => {
        const isValid = await validatePasswordAction('dev', password);
        if (isValid) {
            set({ isDevUnlocked: true });
            return true;
        }
        return false;
    },
    lockDevMode: () => {
        set({ isDevUnlocked: false });
    }
}));

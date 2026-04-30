
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

type UIState = {
  activeTab: string;
  setActiveTab: (tabId: string) => void;
};

export const useUIStateStore = create<UIState>()(
  devtools(
    (set) => ({
      activeTab: 'dashboard',
      setActiveTab: (tabId) => set({ activeTab: tabId }, false, 'setActiveTab'),
    }),
    { name: 'UIStateStore' }
  )
);

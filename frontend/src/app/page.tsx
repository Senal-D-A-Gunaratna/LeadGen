
"use client";

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { DashboardLayout } from '@/components/dashboard/dashboard-layout';
import { Header } from '@/components/dashboard/header';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { AttendanceTable } from '@/components/dashboard/attendance-table';
import { RfidScanner } from '@/components/dashboard/rfid-scanner';
import { AttendanceCharts } from '@/components/dashboard/attendance-charts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from '@/hooks/use-auth-store';
import { useStudentStore } from '@/hooks/use-student-store';
import { useUIStateStore } from '@/hooks/use-ui-state-store';
import { useLogStore } from '@/hooks/use-log-store';
import { useActionLogStore } from '@/hooks/use-action-log-store';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { wsClient } from '@/lib/websocket-client';

// Dynamically import heavy tab components
const AttendanceHistoryTab = dynamic(() => import('@/components/tabs/attendance-history-tab').then(mod => mod.AttendanceHistoryTab), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});
const ManualAttendanceTab = dynamic(() => import('@/components/tabs/manual-attendance-tab').then(mod => mod.ManualAttendanceTab), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});
const ManagePrefectsTab = dynamic(() => import('@/components/tabs/manage-prefects-tab').then(mod => mod.ManagePrefectsTab), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});
const AdminTab = dynamic(() => import('@/components/tabs/admin-tab').then(mod => mod.AdminTab), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});
const DevTab = dynamic(() => import('@/components/tabs/dev-tab').then(mod => mod.DevTab), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});


export default function Home() {
  const { user } = useAuthStore();
  const { actions, fakeDate } = useStudentStore();
  const { activeTab, setActiveTab } = useUIStateStore();
  const { setStatusFilter, setGradeFilter, setClassFilter, setSearchQuery, setRoleFilter, fetchAndSetStudents, getCurrentAppTime, setSelectedDate } = actions;
  const isDev = user?.role === 'dev';
  const isAdmin = user?.role === 'admin';
  const isModerator = user?.role === 'moderator';
  const [appDay, setAppDay] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { initialize: initializeAuthLogs } = useLogStore();
  const { initialize: initializeActionLogs } = useActionLogStore();

  useEffect(() => {
    initializeAuthLogs();
    initializeActionLogs();

    const init = async () => {
      const currentAppTime = await getCurrentAppTime();
      setSelectedDate(currentAppTime);
      setAppDay(format(currentAppTime, 'yyyy-MM-dd'));
      fetchAndSetStudents();
    };

    init();
    
    // WebSocket real-time updates (replaces long-polling)
    wsClient.connect();

    const handleDataChange = async (data: { type: string; data: any }) => {
      // Only refetch in the visible (active) tab and if time is not frozen
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && !fakeDate) {
        await fetchAndSetStudents();
      }
    };

    wsClient.on('data_changed', handleDataChange);

    // Clear cache when tab is hidden and refetch when it becomes visible
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        // Clear in-memory store in this background tab to remain lightweight
        useStudentStore.getState().actions.clearCache();
      } else if (document.visibilityState === 'visible') {
        // When the tab becomes active again, refresh data
        fetchAndSetStudents();
      }
    };

    const handleBeforeUnload = () => {
      // Ensure no stale in-memory data remains when the tab is closed
      useStudentStore.getState().actions.clearCache();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      wsClient.off('data_changed', handleDataChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      // Do not disconnect the global WebSocket here — keep connections open per-tab as requested
    };

    const dayCheckIntervalId = setInterval(async () => {
        const currentAppTime = await getCurrentAppTime();
        const currentAppDay = format(currentAppTime, 'yyyy-MM-dd');
        
        if (currentAppDay !== appDay) {
            setAppDay(currentAppDay);
            // This will trigger the useEffect below
        }
    }, 60000); // Check every minute

    return () => {
      clearInterval(dayCheckIntervalId);
    }
  }, []);

  useEffect(() => {
    // When the app day changes, set the selected date for all tabs and refetch
    setSelectedDate(new Date(appDay + 'T00:00:00'));
  }, [appDay]); 

  // Refetch when fakeDate is changed by dev tools
  useEffect(() => {
    if (fakeDate) {
      setAppDay(format(fakeDate, 'yyyy-MM-dd'));
    } else {
      // If time is reset to live, get the actual current day
      setAppDay(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [fakeDate]); 

  const handleTabChange = (value: string) => {
    setSearchQuery('');
    setStatusFilter(null);
    setGradeFilter('all');
    setClassFilter('all');
    setRoleFilter('all');
    setActiveTab(value);
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
        <Header />
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="attendance-history">Attendance History</TabsTrigger>
            {(isAdmin || isDev) && <TabsTrigger value="manual-attendance">Manual Attendance Marking</TabsTrigger>}
            {(isAdmin || isModerator || isDev) && <TabsTrigger value="manage-prefects">Manage Students</TabsTrigger>}
            {isAdmin && <TabsTrigger value="admin-settings">Admin</TabsTrigger>}
            {isDev && <TabsTrigger value="dev-tools">Dev Tools</TabsTrigger>}
          </TabsList>
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatsCards />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
              <div className="lg:col-span-4">
                <AttendanceTable />
              </div>
              <div className="lg:col-span-3 flex flex-col gap-4">
                 <AttendanceCharts />
                 <RfidScanner />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="attendance-history">
            <AttendanceHistoryTab />
          </TabsContent>
          {(isAdmin || isDev) && (
            <TabsContent value="manual-attendance">
              <ManualAttendanceTab />
            </TabsContent>
          )}
          {(isAdmin || isModerator || isDev) && (
            <TabsContent value="manage-prefects">
              <ManagePrefectsTab />
            </TabsContent>
          )}
           {isAdmin && (
            <TabsContent value="admin-settings">
              <AdminTab />
            </TabsContent>
          )}
           {isDev && (
            <TabsContent value="dev-tools">
              <DevTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

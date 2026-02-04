
"use client";

import { useStudentStore } from "@/hooks/use-student-store";
import { StudentProfileDialog } from "./student-profile-dialog";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useUIStateStore } from "@/hooks/use-ui-state-store";
import { useEffect } from "react";
import { wsClient } from "@/lib/websocket-client";
import { syncClient } from "@/lib/sync-client";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const selectedStudent = useStudentStore((state) => state.selectedStudent);
  const selectStudent = useStudentStore((state) => state.actions.selectStudent);
  const updateStudentSummaries = useStudentStore((state) => state.actions.updateStudentSummaries);
  const { user } = useAuthStore();
  const { activeTab } = useUIStateStore();

  const isPrivilegedUser = !!user && (user.role === 'admin' || user.role === 'dev');
  const canEdit = isPrivilegedUser && activeTab === 'manage-prefects';
  const canDelete = !!user && (user.role === 'admin' || user.role === 'dev');
  const canDownload = !!user && (user.role === 'moderator' || user.role === 'admin' || user.role === 'dev');

  useEffect(() => {
    // Listen for summary updates via centralized sync client
    const handleSummaryUpdate = (event: string, data?: any) => {
      try {
        if (event === 'summary_update' && data && Array.isArray(data.summaries)) {
          updateStudentSummaries(data.summaries);
        }
        if (event === 'all_summaries' && Array.isArray(data)) {
          updateStudentSummaries(data);
        }
      } catch (e) {
        console.error('handleSummaryUpdate', e);
      }
    };

    syncClient.on(handleSummaryUpdate);

    return () => {
      syncClient.off(handleSummaryUpdate);
    };
  }, [updateStudentSummaries]);

  return (
    <>
      <main className="min-h-screen">
        {children}
      </main>
      <StudentProfileDialog
        student={selectedStudent}
        open={!!selectedStudent}
        onOpenChange={(isOpen) => !isOpen && selectStudent(null)}
        canEdit={canEdit}
        canDelete={canDelete}
        canDownload={canDownload}
      />
    </>
  );
}

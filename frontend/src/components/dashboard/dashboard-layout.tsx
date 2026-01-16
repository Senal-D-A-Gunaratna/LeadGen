
"use client";

import { useStudentStore } from "@/hooks/use-student-store";
import { StudentProfileDialog } from "./student-profile-dialog";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useUIStateStore } from "@/hooks/use-ui-state-store";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const selectedStudent = useStudentStore((state) => state.selectedStudent);
  const selectStudent = useStudentStore((state) => state.actions.selectStudent);
  const { user } = useAuthStore();
  const { activeTab } = useUIStateStore();

  const isPrivilegedUser = !!user && (user.role === 'admin' || user.role === 'dev');
  const canEdit = isPrivilegedUser && activeTab === 'manage-prefects';
  const canDelete = !!user && (user.role === 'admin' || user.role === 'dev');
  const canDownload = !!user && (user.role === 'moderator' || user.role === 'admin' || user.role === 'dev');

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

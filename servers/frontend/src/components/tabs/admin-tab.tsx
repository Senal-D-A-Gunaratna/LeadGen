
"use client";

import { useEffect } from "react";
import { useStudentStore } from "@/hooks/use-student-store";
import { PasswordManagement } from "../dashboard/password-management";
import { AdminActions } from "../dashboard/admin-actions";

export function AdminTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasswordManagement />
        <AdminActions />
      </div>
    </div>
  );
}


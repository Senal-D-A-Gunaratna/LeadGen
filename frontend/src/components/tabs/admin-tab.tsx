
"use client";

import { PasswordManagement } from "../dashboard/password-management";
import { AdminActions } from "../dashboard/admin-actions";
import { ActionLog } from "../dashboard/action-log";
import { AuthLog } from "../dashboard/auth-log";
import { BackupManagement } from "../dashboard/backup-management";

export function AdminTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ActionLog />
          <AuthLog />
      </div>
      <BackupManagement />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasswordManagement />
        <AdminActions />
      </div>
    </div>
  );
}

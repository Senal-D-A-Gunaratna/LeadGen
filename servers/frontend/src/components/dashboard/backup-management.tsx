
"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { listBackupsAction, createBackupAction, restoreBackupAction, deleteBackupAction, deleteAllBackupsAction, downloadBackupAction } from "@/app/actions";
import { Database, History, Trash2, RotateCcw, Loader2, Download } from "lucide-react";
import { DevAuthDialog } from "./dev-auth-dialog";
import { useStudentStore } from "@/hooks/use-student-store";
import { ScrollArea } from "../ui/scroll-area";
import { format } from "date-fns";
import { Separator } from "../ui/separator";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { RolePasswordDialog } from "./role-password-dialog";
import { apiClient } from "@/lib/api-client";
import { syncClient } from "@/lib/sync-client";

type DataType = 'students' | 'attendance';
type AuthActionType = 'restore' | 'delete' | 'deleteAll';

export function BackupManagement() {
  const { toast } = useToast();
  const { addActionLog } = useActionLogStore();
  const { user } = useAuthStore();
  const { actions: { fetchAndSetStudents, getCurrentAppTime }, fakeDate } = useStudentStore();
  const [backups, setBackups] = useState<{ students: string[], attendance: string[] }>({ students: [], attendance: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isActioning, setIsActioning] = useState<string | null>(null);

  const [authDialog, setAuthDialog] = useState<{
    isOpen: boolean;
    dataType: DataType | null;
    fileName: string | null;
    actionType: AuthActionType | null;
  }>({ isOpen: false, dataType: null, fileName: null, actionType: null });

  const fetchBackups = async () => {
    setIsLoading(true);
    try {
      const backupFiles = await listBackupsAction();
      setBackups(backupFiles);
      return backupFiles;
    } catch (error) {
      toast({ variant: "destructive", title: "Failed to load backups" });
      return { students: [], attendance: [] };
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();

    // Keep backup list in sync with server via WebSocket events
    // Connection handled centrally in `servers/frontend/src/app/page.tsx`
    const handler = (payload?: any) => {
      try {
        const type = payload?.type;
        if (type === "backups_changed") fetchBackups();
      } catch (e) {}
    };

    const syncListener = (event: string, payload?: any) => {
      if (event === 'data_changed') return handler(payload);
      if (event === 'students_refreshed' || event === 'all_summaries') return fetchBackups();
    };

    try { syncClient.on(syncListener); } catch (e) {}

    return () => {
      try { syncClient.off(syncListener); } catch (e) {}
    };
  }, []);
  
  const handleCreateBackup = async (dataType: DataType) => {
    const actionKey = `create-${dataType}-all`;
    setIsActioning(actionKey);
    const authorizerRole = user?.role || 'user';
    try {
        const now = await getCurrentAppTime();
        const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
        const backupFileName = await createBackupAction(dataType, timestamp, !!fakeDate);
        toast({ title: "Backup Created", description: `A new ${dataType} backup has been saved.` });
        addActionLog(`[${authorizerRole}] Created backup: ${backupFileName}`);
        await fetchBackups();
    } catch (error) {
        toast({ variant: "destructive", title: "Backup Failed", description: "An unexpected error occurred." });
    } finally {
        setIsActioning(null);
    }
  };

  const handleDownloadBackup = async (dataType: DataType, fileName: string) => {
    const actionKey = `download-${dataType}-${fileName}`;
    setIsActioning(actionKey);
    try {
      const fileContent = await downloadBackupAction(dataType, fileName);
      // fileContent may be a Blob (preferred) or ArrayBuffer/string; normalize to Blob
      let fileBlob: Blob;
      const isBlob = (v: any): v is Blob => v && typeof v === 'object' && typeof (v as any).arrayBuffer === 'function';
      const isArrayBuffer = (v: any): v is ArrayBuffer => v && (v instanceof ArrayBuffer || (v && typeof v.byteLength === 'number' && typeof v.slice === 'function'));

      if (isBlob(fileContent)) {
        fileBlob = fileContent;
      } else if (isArrayBuffer(fileContent)) {
        // fallback: assume base64 string (older behavior) and decode
        fileBlob = new Blob([fileContent], { type: "application/x-sqlite3" });
      } else if (typeof fileContent === 'string') {
        try {
          const binary = atob(fileContent);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
          fileBlob = new Blob([bytes], { type: "application/x-sqlite3" });
        } catch (e) {
          throw new Error('Downloaded data is not a valid binary file');
        }
      } else {
        // last-resort: stringify and save as text (not ideal)
        fileBlob = new Blob([String(fileContent)], { type: "application/x-sqlite3" });
      }

      const url = URL.createObjectURL(fileBlob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addActionLog(`[${user?.role}] Downloaded backup: ${fileName}`);
    } catch (error) {
      toast({ variant: "destructive", title: "Download Failed" });
    } finally {
      setIsActioning(null);
    }
  };

  const handleRestoreBackup = async (dataType: DataType, fileName: string) => {
    const actionKey = `restore-${dataType}-${fileName}`;
    setIsActioning(actionKey);
    const authorizerRole = user?.role || 'user';
    
    try {
      await restoreBackupAction(dataType, fileName);
      addActionLog(`[${authorizerRole}] Restored backup: ${fileName}`);
      toast({ title: "Restore Successful", description: `${fileName} was restored.` });
      await fetchAndSetStudents();
    } catch (error) {
      toast({ variant: "destructive", title: "Restore Failed", description: "Could not restore the backup." });
    } finally {
      setIsActioning(null);
    }
  };

  const handleRequestAuth = (dataType: DataType | null, fileName: string | null, actionType: AuthActionType) => {
    setAuthDialog({ isOpen: true, dataType, fileName, actionType });
  };
  
  const handleAuthorizedAction = async (password?: string) => {
    if (!authDialog.actionType) return;

    const { dataType, fileName, actionType } = authDialog;
    const actionKey = `${actionType}-${dataType}-${fileName || 'all'}`;
    const authorizerRole = user?.role || 'user';
    setIsActioning(actionKey);

    try {
      if (actionType === 'restore' && dataType && fileName) {
        await restoreBackupAction(dataType, fileName);
        addActionLog(`[${authorizerRole}] Restored backup: ${fileName}`);
        toast({ title: "Restore Successful", description: `${fileName} was restored.` });
        await fetchAndSetStudents();

      } else if (actionType === 'delete' && dataType && fileName) {
        const willBeEmpty = backups[dataType].length === 1;
        
        await deleteBackupAction(dataType, fileName);
        addActionLog(`[${authorizerRole}] Deleted backup: ${fileName}`);

        if (!willBeEmpty) {
          toast({ title: "Backup Deleted", description: `${fileName} has been deleted.` });
          await fetchBackups();
        } else {
            // It was the last backup, create a new one silently
            const now = await getCurrentAppTime();
            const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
            await createBackupAction(dataType, timestamp, !!fakeDate);
            const backupTypeName = dataType === 'students' ? 'student data' : 'attendance history';
            toast({ title: "Last Backup Replaced", description: `The final ${backupTypeName} backup was deleted, so a new safety backup has been created.` });
            addActionLog(`[${authorizerRole}] Auto-created ${backupTypeName} safety backup.`);
            await fetchBackups();
        }
      } else if (actionType === 'deleteAll') {
        const hadBackups = backups.students.length > 0 || backups.attendance.length > 0;
        await deleteAllBackupsAction();
        
        if (hadBackups) {
            addActionLog(`[${authorizerRole}] Deleted all backups.`);
            toast({ 
                title: "All Backups Deleted", 
                description: "All backup files have been removed. New safety backups for student data and attendance history have been created." 
            });
        }

        // Now create new safety backups
        const now = await getCurrentAppTime();
        const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
        await createBackupAction('students', timestamp, !!fakeDate);
        addActionLog(`[${authorizerRole}] Auto-created student data safety backup.`);
        await createBackupAction('attendance', timestamp, !!fakeDate);
        addActionLog(`[${authorizerRole}] Auto-created attendance history safety backup.`);
        await fetchBackups();
      }

    } catch (error) {
      toast({ variant: "destructive", title: `${actionType.charAt(0).toUpperCase() + actionType.slice(1)} Failed`, description: "An unexpected error occurred." });
       await fetchBackups(); // fetch backups even on failure to get latest state
    } finally {
      setIsActioning(null);
      setAuthDialog({ isOpen: false, dataType: null, fileName: null, actionType: null });
    }
  };
  

  const BackupList = ({ type, files }: { type: DataType, files: string[] }) => (
    <div>
        <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold flex items-center gap-2">
                {type === 'students' ? <Database /> : <History />}
                {type === 'students' ? 'Student Data Backups' : 'Attendance History Backups'}
            </h4>
            <div className="flex gap-2">
                <Button size="sm" onClick={() => handleCreateBackup(type)} disabled={!!isActioning}>
                    {isActioning === `create-${type}-all` ? <Loader2 className="animate-spin" /> : 'Create Backup'}
                </Button>
            </div>
        </div>
        <ScrollArea className="h-48 pr-4 border rounded-md">
            <div className="p-2 space-y-2">
            {isLoading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin"/></div>
            ) : files.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center p-4">No backups found.</p>
            ) : (
                files.map(file => {
                    const restoreKey = `restore-${type}-${file}`;
                    const deleteKey = `delete-${type}-${file}`;
                    const downloadKey = `download-${type}-${file}`;
                    const isRestoring = isActioning === restoreKey;
                    const isDeleting = isActioning === deleteKey;
                    const isDownloading = isActioning === downloadKey;
                    
                    return (
                        <div key={file} className="flex items-center justify-between p-2 glassmorphic rounded-md">
                            <span className="text-sm truncate">{file.replace(`-${type}-data-backup-`, ' ').replace(`-FROZEN`, ' (Frozen)')}</span>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!isActioning} onClick={() => handleDownloadBackup(type, file)}>
                                    {isDownloading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Download className="h-4 w-4 text-blue-500" />}
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!isActioning}>
                                            {isRestoring ? <Loader2 className="h-4 w-4 animate-spin"/> : <RotateCcw className="h-4 w-4 text-green-500" />}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="glassmorphic glowing-border">
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Restore {type} data?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will overwrite current {type} data with the contents of this backup, This action requires authorization and is not reversible
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleRequestAuth(type, file, 'restore')}>Continue</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!isActioning}>
                                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4 text-red-500" />}
                                        </Button>
                                    </AlertDialogTrigger>
                                     <AlertDialogContent className="glassmorphic glowing-border">
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Permanently delete the backup file: {file}. This action requires authorization and cannot be undone
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleRequestAuth(type, file, 'delete')}>Delete</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    );
                })
            )}
            </div>
        </ScrollArea>
    </div>
  );

  return (
    <>
      <Card className="glassmorphic glowing-border">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Backup Management</CardTitle>
          <CardDescription>
            Create, restore, and delete backups for student and attendance data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BackupList type="students" files={backups.students} />
              <BackupList type="attendance" files={backups.attendance} />
            </div>
            <Separator />
             <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                <div>
                  <h3 className="font-semibold text-destructive">
                    Delete All Backups
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete all student and attendance backups
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={!!isActioning || (backups.students.length === 0 && backups.attendance.length === 0)}>
                      {isActioning === 'deleteAll--all' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                       Delete All
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="glassmorphic glowing-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action is irreversible and requires developer authorization, It will permanently delete ALL backup files
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRequestAuth(null, null, 'deleteAll')}>
                        Continue to Authorization
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            </div>
        </CardContent>
      </Card>
      
      {user?.role === 'dev' && (
        <DevAuthDialog
            open={authDialog.isOpen}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    setAuthDialog({ isOpen: false, dataType: null, fileName: null, actionType: null });
                }
            }}
            onSuccess={handleAuthorizedAction}
        />
      )}

      {user?.role === 'admin' && (
        <RolePasswordDialog
            role="admin"
            open={authDialog.isOpen}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    setAuthDialog({ isOpen: false, dataType: null, fileName: null, actionType: null });
                }
            }}
            onSuccess={handleAuthorizedAction}
            title="Admin Authorization"
            description="Please enter the admin password to confirm this action."
        />
      )}
    </>
  );
}

    

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
import { useStudentStore } from "@/hooks/use-student-store";
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
} from "@/components/ui/alert-dialog";
import { PasswordManagement } from "../dashboard/password-management";
import { Calendar } from "../ui/calendar";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { CalendarIcon, RotateCcw, Clock, Lock, Unlock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BackupManagement } from "../dashboard/backup-management";
import { AuthLog } from "../dashboard/auth-log";
import { ActionLog } from "../dashboard/action-log";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { RolePasswordDialog } from "../dashboard/role-password-dialog";
import { useLogStore } from "@/hooks/use-log-store";

function DevLocker({ title, onUnlock }: { title: string, onUnlock: () => void }) {
  const { isDevUnlocked } = useAuthStore();
  return (
    <Button variant="ghost" size="icon" onClick={onUnlock} className="h-6 w-6">
      {isDevUnlocked ? <Unlock className="text-green-500" /> : <Lock className="text-red-500" />}
       <span className="sr-only">Toggle lock for {title}</span>
    </Button>
  )
}

function CurrentAppTime() {
  const { fakeDate } = useStudentStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    if (fakeDate) {
      setTime(new Date(fakeDate));
      // No interval needed for frozen time
      return;
    }

    // If not frozen, update every second
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, [fakeDate]);
  
  return (
    <Card className="glassmorphic glowing-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
                <CardTitle className="font-headline text-primary">Application Time</CardTitle>
                <CardDescription>
                    {fakeDate ? "Time is currently frozen." : "Using live system time."}
                </CardDescription>
            </div>
            <Clock className="h-6 w-6 text-muted-foreground"/>
        </CardHeader>
        <CardContent>
            <div className="text-3xl font-bold font-mono text-center py-4">
                {format(time, "PPP, HH:mm:ss")}
            </div>
        </CardContent>
    </Card>
  )
}

function TimeFreeze({ onUnlockRequest }: { onUnlockRequest: () => void }) {
    const { actions, fakeDate } = useStudentStore();
    const { addActionLog } = useActionLogStore();
    const { isDevUnlocked } = useAuthStore();
    const [date, setDate] = useState<Date | undefined>(fakeDate ? new Date(fakeDate) : undefined);
    const [time, setTime] = useState(fakeDate ? format(new Date(fakeDate), "HH:mm") : "07:00");
    const { toast } = useToast();

    useEffect(() => {
        if(fakeDate) {
            setDate(new Date(fakeDate));
            setTime(format(new Date(fakeDate), "HH:mm"));
        } else {
            setDate(undefined);
            setTime("07:00");
        }
    }, [fakeDate]);


    const handleSetFakeDate = () => {
        if (!date) {
            toast({ variant: "destructive", title: "No Date Selected", description: "Please select a date to freeze."});
            return;
        }
        
        const [hours, minutes] = time.split(':').map(Number);
        const newFakeDate = new Date(date);
        newFakeDate.setHours(hours, minutes, 0, 0);

        actions.setFakeDate(newFakeDate);
        const formattedDate = format(newFakeDate, "PPP, p");
        addActionLog(`[Dev] Froze time to ${formattedDate}.`);
        toast({
            title: "Time Frozen",
            description: `App time is now set to ${formattedDate}.`,
        });
    };
    
    const handleResetFakeDate = () => {
        actions.setFakeDate(null);
        addActionLog(`[Dev] Reset time to live.`);
        toast({
            title: "Time Reset",
            description: "Application is now using live time.",
        });
    }

    return (
         <Card className="glassmorphic glowing-border">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="font-headline text-primary">Time Freeze Controls</CardTitle>
                    <CardDescription>
                        Freeze the application's internal clock for testing.
                    </CardDescription>
                </div>
                <DevLocker title="Time Freeze" onUnlock={onUnlockRequest} />
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            disabled={!isDevUnlocked}
                            className={cn(
                            "justify-start text-left font-normal glassmorphic",
                            !date && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {date ? format(date, "PPP") : <span>Pick a date</span>}
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={setDate}
                            initialFocus
                            weekStartsOn={1}
                        />
                        </PopoverContent>
                    </Popover>
                    <Input 
                        type="time"
                        value={time}
                        disabled={!isDevUnlocked}
                        onChange={(e) => setTime(e.target.value)}
                        className="glassmorphic"
                    />
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleSetFakeDate} className="w-full" disabled={!isDevUnlocked}>Freeze Time</Button>
                    <Button onClick={handleResetFakeDate} variant="secondary" className="w-full" disabled={!fakeDate || !isDevUnlocked}>
                        <RotateCcw className="mr-2 h-4 w-4"/>
                        Reset to Live
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function DebugActions({ onUnlockRequest }: { onUnlockRequest: () => void }) {
  const { actions } = useStudentStore();
  const { toast } = useToast();
  const { addActionLog } = useActionLogStore();
  const { isDevUnlocked } = useAuthStore();
  
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [actionToConfirm, setActionToConfirm] = useState<'delete-history' | 'delete-students' | 'reset-daily' | null>(null);

  const handleScan = () => {
    // Simulate a random fingerprint scan
    const { students } = useStudentStore.getState();
    if (students.length > 0) {
      const randomStudent = students[Math.floor(Math.random() * students.length)];
      const randomFingerprint = randomStudent.fingerprints[Math.floor(Math.random() * 4)];
      if (randomFingerprint) {
        actions.scanStudent(randomFingerprint);
        addActionLog(`[Dev] Simulated scan for ${randomStudent.name}.`);
        toast({
          title: "Dev Scan Simulated",
          description: `Scanned for ${randomStudent.name}.`,
        });
      } else {
         toast({
            variant: "destructive",
            title: "No fingerprint to scan",
            description: `${randomStudent.name} does not have a registered fingerprint to simulate a scan with.`,
         });
      }
    } else {
      toast({
        variant: "destructive",
        title: "No students to scan",
        description: "Please add students before simulating a scan.",
      });
    }
  };
  
  const handleRequest = (action: 'delete-history' | 'delete-students' | 'reset-daily') => {
    setActionToConfirm(action);
    setConfirmDialogOpen(true);
  };
  
  const handleConfirmation = () => {
    // For always-auth actions, go to auth dialog. For others, execute directly.
    if (actionToConfirm === 'delete-history' || actionToConfirm === 'delete-students') {
        setConfirmDialogOpen(false);
        setAuthDialogOpen(true);
    } else if (actionToConfirm === 'reset-daily') {
        handleAuthorizedAction();
        setConfirmDialogOpen(false);
    }
  };
  
  const handleAuthorizedAction = async () => {
    if (!actionToConfirm) return;
    
    // Close any open dialogs
    setAuthDialogOpen(false);
    setConfirmDialogOpen(false);

    if (actionToConfirm === 'delete-history') {
      await actions.deleteEntireHistory();
      addActionLog('[Dev] Deleted all attendance history.');
      toast({
        title: "Attendance History Deleted",
        description: "All historical attendance data has been cleared.",
      });
    } else if (actionToConfirm === 'delete-students') {
      await actions.deleteAllStudentData();
      addActionLog('[Dev] Deleted all student data.');
      toast({
        title: "All Student Data Deleted",
        description: "All student profiles and related history have been cleared.",
      });
    } else if (actionToConfirm === 'reset-daily') {
        await actions.resetDailyData();
        addActionLog('[Dev] Reset daily data.');
        toast({
            title: "Daily Data Reset",
            description: "All student statuses have been reset to 'absent'.",
        });
    }
    setActionToConfirm(null);
  }

  const getDialogContent = () => {
    switch(actionToConfirm) {
        case 'delete-history':
            return {
                title: "Are you absolutely sure?",
                description: "This will permanently delete all attendance history for every student. This action requires password authorization and cannot be undone."
            };
        case 'delete-students':
             return {
                title: "Are you absolutely sure?",
                description: "This will permanently delete all student profiles and all attendance history. This action requires password authorization and cannot be undone."
            };
        case 'reset-daily':
             return {
                title: "Are you absolutely sure?",
                description: "This will reset all student statuses to 'absent' for the current day. This action cannot be undone."
            };
        default:
            return { title: '', description: '' };
    }
  }
  
  const { title, description } = getDialogContent();
  const authAction = actionToConfirm === 'delete-history' || actionToConfirm === 'delete-students';

  return (
    <>
    <Card className="glassmorphic glowing-border">
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
                <CardTitle className="font-headline text-primary">Debug Actions</CardTitle>
                <CardDescription>
                Tools to test and debug application functionality.
                </CardDescription>
            </div>
             <DevLocker title="Debug Actions" onUnlock={onUnlockRequest} />
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                    <h3 className="font-semibold">Simulate Fingerprint Scan</h3>
                    <p className="text-sm text-muted-foreground">Trigger a scan for a random student.</p>
                </div>
                <Button onClick={handleScan} disabled={!isDevUnlocked}>Simulate Scan</Button>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                    <h3 className="font-semibold">Reset Daily Data</h3>
                    <p className="text-sm text-muted-foreground">Reset all students to `absent` for today.</p>
                </div>
                <Button variant="secondary" onClick={() => handleRequest('reset-daily')} disabled={!isDevUnlocked}>Reset Data</Button>
            </div>
             <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                <div>
                    <h3 className="font-semibold text-destructive">Delete All Student Data</h3>
                    <p className="text-sm text-muted-foreground">Permanently delete all students and their history.</p>
                </div>
                <Button variant="destructive" onClick={() => handleRequest('delete-students')}>Delete Data</Button>
            </div>
            <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                <div>
                    <h3 className="font-semibold text-destructive">Delete All Attendance History</h3>
                    <p className="text-sm text-muted-foreground">Permanently delete all historical attendance records.</p>
                </div>
                <Button variant="destructive" onClick={() => handleRequest('delete-history')}>Delete History</Button>
            </div>
        </CardContent>
    </Card>
    <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent className="glassmorphic glowing-border">
            <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>
                {description}
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setActionToConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmation}>
              {authAction ? 'Continue to Authorization' : 'Continue'}
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
     <RolePasswordDialog
        role="dev"
        open={authDialogOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setAuthDialogOpen(false);
            setActionToConfirm(null);
          }
        }}
        onSuccess={handleAuthorizedAction}
        title="Developer Authorization Required"
        description="This is a highly destructive action. Please enter the developer password to confirm."
      />
    </>
  );
}


export function DevTab() {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const { isDevUnlocked, unlockDevMode, lockDevMode } = useAuthStore();
  const { addLog } = useLogStore();
  const { addActionLog } = useActionLogStore();
  const { toast } = useToast();

  const handleUnlockRequest = () => {
    if (isDevUnlocked) {
      lockDevMode();
      addActionLog("[Dev] Locked developer mode.");
      toast({ title: "Developer Mode Locked", description: "Sensitive actions are now disabled." });
    } else {
      setIsAuthDialogOpen(true);
    }
  }

  const handleUnlockAttempt = (password: string) => {
    const success = unlockDevMode(password);
    if(success) {
      addActionLog("[Dev] Unlocked developer mode.");
      toast({ title: "Developer Mode Unlocked", description: "Sensitive actions are now enabled." });
      setIsAuthDialogOpen(false);
    } else {
      addLog("Failed dev authorization attempt.");
      toast({ variant: "destructive", title: "Authorization Failed", description: "Incorrect developer password." });
      return false;
    }
    return true;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ActionLog />
            <AuthLog />
        </div>

        <BackupManagement />
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CurrentAppTime />
            <TimeFreeze onUnlockRequest={handleUnlockRequest}/>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PasswordManagement onUnlockRequest={handleUnlockRequest} />
            <DebugActions onUnlockRequest={handleUnlockRequest} />
        </div>
      </div>

      <RolePasswordDialog
        role="dev"
        open={isAuthDialogOpen}
        onOpenChange={setIsAuthDialogOpen}
        onSuccess={(password) => {
          if (password) {
            return handleUnlockAttempt(password)
          }
          return true;
        }}
        title="Developer Authorization"
        description="Enter the developer password to unlock sensitive controls."
        isUnlockAttempt={true}
      />
    </>
  );
}

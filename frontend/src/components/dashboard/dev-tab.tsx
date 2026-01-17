
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PasswordManagement } from "../dashboard/password-management";
import { DevAuthDialog } from "../dashboard/dev-auth-dialog";
import { Calendar } from "../ui/calendar";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { CalendarIcon, RotateCcw, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BackupManagement } from "./backup-management";

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

function TimeFreeze() {
    const { actions, fakeDate } = useStudentStore();
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
        toast({
          title: "Time Frozen",
          description: `App time is now set to ${format(newFakeDate, "PPP, HH:mm")}.`,
        });
    };
    
    const handleResetFakeDate = () => {
        actions.setFakeDate(null);
        toast({
            title: "Time Reset",
            description: "Application is now using live time.",
        });
    }

    return (
         <Card className="glassmorphic glowing-border">
            <CardHeader>
                <CardTitle className="font-headline text-primary">Time Freeze Controls</CardTitle>
                <CardDescription>
                    Freeze the application's internal clock to a specific date and time for testing.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
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
                        />
                        </PopoverContent>
                    </Popover>
                    <Input 
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="glassmorphic"
                    />
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleSetFakeDate} className="w-full">Freeze Time</Button>
                    <Button onClick={handleResetFakeDate} variant="secondary" className="w-full" disabled={!fakeDate}>
                        <RotateCcw className="mr-2 h-4 w-4"/>
                        Reset to Live
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

export function DevTab() {
  const { actions } = useStudentStore();
  const { toast } = useToast();
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const handleScan = () => {
    // Simulate a random fingerprint scan
    const { students } = useStudentStore.getState();
    if (students.length > 0) {
      const randomStudent = students[Math.floor(Math.random() * students.length)];
      const randomFingerprint = randomStudent.fingerprints[Math.floor(Math.random() * 4)];
      if (randomFingerprint) {
        actions.scanStudent(randomFingerprint);
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

  const handleReset = () => {
     actions.resetDailyData();
     toast({
        title: "Daily Data Reset",
        description: "All student statuses have been reset to 'absent'.",
      });
     setIsResetConfirmOpen(false);
  }
  
  const handleDeleteHistoryRequest = () => {
    // This closes the first dialog and opens the auth dialog
    setIsDeleteConfirmOpen(false);
    setIsAuthDialogOpen(true);
  };
  
  const handleAuthorizedDelete = () => {
    actions.deleteEntireHistory();
    toast({
      title: "Attendance History Deleted",
      description: "All historical attendance data has been cleared.",
    });
    setIsAuthDialogOpen(false); // Close the auth dialog
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <PasswordManagement />
          <BackupManagement />
        </div>
        <div className="flex flex-col gap-4">
            <CurrentAppTime />
            <TimeFreeze />
            <Card className="glassmorphic glowing-border">
            <CardHeader>
                <CardTitle className="font-headline text-primary">Debug Actions</CardTitle>
                <CardDescription>
                Use these tools to test and debug application functionality.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                        <h3 className="font-semibold">Simulate Fingerprint Scan</h3>
                        <p className="text-sm text-muted-foreground">Trigger a scan for a random student.</p>
                    </div>
                    <Button onClick={handleScan}>Simulate Scan</Button>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                        <h3 className="font-semibold">Reset Daily Data</h3>
                        <p className="text-sm text-muted-foreground">Reset all students to `absent` for today.</p>
                    </div>
                    <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
                    <AlertDialogTrigger asChild>
                        <Button variant="secondary">Reset Data</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glassmorphic glowing-border">
                        <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action will reset the attendance status for all students to 'absent' for today. This cannot be undone.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleReset}>Continue</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                </div>
                <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                    <div>
                        <h3 className="font-semibold text-destructive">Delete All Attendance History</h3>
                        <p className="text-sm text-muted-foreground">Permanently delete all historical attendance records.</p>
                    </div>
                    <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive">Delete History</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glassmorphic glowing-border">
                        <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action is irreversible and requires developer authorization. This will permanently delete all attendance history for every student.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteHistoryRequest}>Continue to Authorization</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
            </Card>
        </div>
      </div>
      <DevAuthDialog
        open={isAuthDialogOpen}
        onOpenChange={setIsAuthDialogOpen}
        onSuccess={handleAuthorizedDelete}
      />
    </>
  );
}

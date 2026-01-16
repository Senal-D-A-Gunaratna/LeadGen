
"use client";

import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStudentStore } from "@/hooks/use-student-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { useToast } from "@/hooks/use-toast";
import type { AttendanceStatus, Student } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { Search, X, Calendar as CalendarIcon, Save, Loader2, RotateCcw } from "lucide-react";
import { RolePasswordDialog } from "../dashboard/role-password-dialog";
import { CLASSES, PREFECT_ROLES } from "@/lib/student-data";

type PendingChanges = Record<number, AttendanceStatus>;
const GRADES = ["6", "7", "8", "9", "10", "11", "12", "13"];

export function ManualAttendanceTab() {
  const { students, actions, fakeDate, searchQuery, gradeFilter, classFilter, roleFilter, isLoading } = useStudentStore(
    state => ({
      students: state.students,
      actions: state.actions,
      fakeDate: state.fakeDate,
      searchQuery: state.searchQuery,
      gradeFilter: state.gradeFilter,
      classFilter: state.classFilter,
      roleFilter: state.roleFilter,
      isLoading: state.isLoading,
    })
  );
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const { toast } = useToast();
  const { setSearchQuery, setGradeFilter, setClassFilter, setRoleFilter, selectStudent, setSelectedDate, fetchAndSetStudents } = actions;
  
  const selectedDate = useStudentStore(state => state.selectedDate);
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  useEffect(() => {
    setSelectedDate(fakeDate ? new Date(fakeDate) : new Date());
  }, [fakeDate, setSelectedDate]);
  
  useEffect(() => {
    // Clear pending changes when the date changes in the store
    setPendingChanges({});
  }, [selectedDate]);

  // Refetch when any filter changes
  useEffect(() => {
    fetchAndSetStudents();
  }, [searchQuery, gradeFilter, classFilter, roleFilter, selectedDate, fetchAndSetStudents]);

  const availableGrades = GRADES;

  const studentsWithPendingChanges = useMemo(() => {
    return students.map(student => ({
        ...student,
        status: pendingChanges[student.id] || student.status,
    }));
  }, [students, pendingChanges]);
  
  const handleStatusChange = (studentId: number, newStatus: AttendanceStatus) => {
    setPendingChanges(prev => ({
        ...prev,
        [studentId]: newStatus
    }));
  };

  const handleSaveChanges = () => {
    if (Object.keys(pendingChanges).length === 0) {
      toast({ title: "No Changes", description: "You haven't made any attendance changes to save." });
      return;
    }
    setIsAuthOpen(true);
  }
  
  const handleAuthorizedSave = async () => {
    setIsAuthOpen(false);
    setIsSaving(true);
    try {
        if (!selectedDate) {
            throw new Error("No date selected.");
        }
        await actions.updateBulkAttendance(selectedDate, pendingChanges);
        addActionLog(`[${user?.role}] Manually marked attendance for ${format(selectedDate, 'PPP')}.`);
        toast({
            title: "Attendance Updated",
            description: `Manual attendance changes for ${format(selectedDate, 'PPP')} have been saved.`
        });
        setPendingChanges({});
    } catch(e) {
        console.error(e);
        toast({ variant: "destructive", title: "Save Failed", description: "An unexpected error occurred while saving." });
    } finally {
        setIsSaving(false);
    }
  }

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  return (
    <>
      <Card className="glassmorphic glowing-border">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Manual Attendance Marking</CardTitle>
          <CardDescription>
            Select a date and manually set the attendance status for students. Changes are saved in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 w-full mb-4">
            <div className="relative flex-grow min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone number"
                className="pl-9 pr-9 glassmorphic"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full sm:w-auto justify-start text-left font-normal glassmorphic",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => setSelectedDate(date)}
                  disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
                  initialFocus
                  weekStartsOn={1}
                />
              </PopoverContent>
            </Popover>
             <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                <SelectValue placeholder="Filter by grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {availableGrades.map(grade => (
                    <SelectItem key={grade} value={grade}>Grade {grade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                <SelectValue placeholder="Filter by class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {CLASSES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
             <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="glassmorphic w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                     <SelectItem value="none">No Role</SelectItem>
                    {PREFECT_ROLES.map(role => (
                        <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
          </div>

          <div className="h-[500px] overflow-y-auto rounded-md border border-border/40">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentsWithPendingChanges.map(student => (
                    <TableRow key={student.id} className="border-border/40 hover:bg-muted/60">
                      <TableCell className="font-medium cursor-pointer" onClick={() => selectStudent(student)}>{student.name}</TableCell>
                      <TableCell>{student.grade}</TableCell>
                      <TableCell>{student.className}</TableCell>
                      <TableCell className="text-right">
                        <Select 
                          value={student.status}
                          onValueChange={(newStatus: AttendanceStatus) => handleStatusChange(student.id, newStatus)}
                        >
                          <SelectTrigger className="w-[120px] glassmorphic">
                            <SelectValue placeholder="Set status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="on time">On Time</SelectItem>
                            <SelectItem value="late">Late</SelectItem>
                            <SelectItem value="absent">Absent</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
            {hasPendingChanges && (
                <Button variant="ghost" onClick={() => setPendingChanges({})} disabled={isSaving}>
                   <RotateCcw className="mr-2 h-4 w-4" />
                   Discard Changes
                </Button>
            )}
            <Button onClick={handleSaveChanges} disabled={!hasPendingChanges || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
            </Button>
        </CardFooter>
      </Card>
      {user?.role && (
        <RolePasswordDialog
          role={user.role}
          open={isAuthOpen}
          onOpenChange={setIsAuthOpen}
          onSuccess={handleAuthorizedSave}
          title="Authorize Attendance Update"
          description={`Enter your ${user.role} password to save these attendance changes.`}
        />
      )}
    </>
  );
}

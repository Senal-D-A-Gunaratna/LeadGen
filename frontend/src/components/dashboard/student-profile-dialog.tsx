

"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import type { Student, AttendanceStatus, PrefectRole } from "@/lib/types";
import { Mail, Phone, GraduationCap, Trash2, Loader2, Save, Pencil, UserCheck, Clock, UserX, Edit, Download, FileText, Fingerprint, File as FileIcon } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
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
import { Button } from "../ui/button";
import { useStudentStore } from "@/hooks/use-student-store";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "../ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { PREFECT_ROLES, CLASSES } from "@/lib/student-data";
import { Badge } from "../ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { calculateAttendancePercentage, isWeekday, parseDate } from "@/lib/utils";
import { Textarea } from "../ui/textarea";
import { downloadStudentAttendanceSummaryAsCsvAction, downloadStudentAttendanceSummaryAsPdfAction } from "@/app/actions";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { RolePasswordDialog } from "./role-password-dialog";

interface StudentProfileDialogProps {
  student: Student | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  canDownload: boolean;
}

const statusColors: Record<AttendanceStatus, string> = {
  "on time": 'hsl(var(--chart-2))',
  absent: 'hsl(var(--destructive))',
  late: 'hsl(var(--chart-3))',
};

const editFormSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  fingerprint1: z.string().optional(),
  fingerprint2: z.string().optional(),
  fingerprint3: z.string().optional(),
  fingerprint4: z.string().optional(),
  grade: z.coerce.number().min(6, { message: "Grade must be between 6 and 13." }).max(13, { message: "Grade must be between 6 and 13." }),
  className: z.string().min(1, { message: "Class is required." }),
  role: z.string().optional(),
  contact: z.object({
    email: z.string().email({ message: "Invalid email address." }).optional().or(z.literal('')),
    phone: z.string().length(10, { message: "Phone number must be exactly 10 digits." }),
  }),
  specialRoles: z.string().optional(),
  notes: z.string().optional(),
});

const GRADES = Array.from({ length: 8 }, (_, i) => i + 6); // 6 to 13

function RemoveStudentButton({ student, onDeleted, canDelete }: { student: Student, onDeleted: () => void, canDelete: boolean }) {
  const { actions } = useStudentStore();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [isPending, setIsPending] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  const handleRequestAuth = () => {
    setIsAlertOpen(false); // Close confirmation dialog
    setIsAuthOpen(true);   // Open password dialog
  }

  const handleAuthorizedRemove = async () => {
    setIsAuthOpen(false); // Close password dialog
    setIsPending(true);
    try {
        await actions.removeStudent(student.id);
        toast({
            title: "Student Removed",
            description: `${student.name} has been removed from the roster.`,
        });
        onDeleted();
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Failed to remove student",
            description: "An unexpected error occurred.",
        });
        console.error(error);
    } finally {
        setIsPending(false);
    }
  };

  if (!canDelete || !user) return null;

  return (
    <>
      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={isPending}>
             {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
             Remove Student
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="glassmorphic glowing-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete {student.name}'s records and requires password authorization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRequestAuth}>
              Continue to Authorization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RolePasswordDialog
        role={user.role}
        open={isAuthOpen}
        onOpenChange={setIsAuthOpen}
        onSuccess={handleAuthorizedRemove}
        title="Authorize Deletion"
        description={`Please enter your ${user.role} password to permanently delete ${student.name}.`}
      />
    </>
  );
}

function EditStudentForm({ student, onFinished }: { student: Student, onFinished: () => void}) {
  const [isPending, setIsPending] = useState(false);
  const { actions } = useStudentStore();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  
  const isDev = user?.role === 'dev';
  const isAdmin = user?.role === 'admin';

  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: student.name,
      fingerprint1: student.fingerprints[0] || '',
      fingerprint2: student.fingerprints[1] || '',
      fingerprint3: student.fingerprints[2] || '',
      fingerprint4: student.fingerprints[3] || '',
      grade: student.grade,
      className: student.className,
      role: student.role || 'none',
      contact: {
        email: student.contact.email,
        phone: student.contact.phone,
      },
      specialRoles: student.specialRoles || '',
      notes: student.notes || '',
    },
  });

  async function onSubmit(values: z.infer<typeof editFormSchema>) {
    setIsPending(true);
    try {
      const updatedDetails: Partial<Omit<Student, 'id'>> = {
        name: values.name,
        grade: values.grade,
        className: values.className,
        contact: values.contact,
        role: values.role === 'none' ? undefined : (values.role as PrefectRole),
        specialRoles: values.specialRoles,
        notes: values.notes,
      };

      if (isDev) {
        updatedDetails.fingerprints = [
          values.fingerprint1 || '',
          values.fingerprint2 || '',
          values.fingerprint3 || '',
          values.fingerprint4 || '',
        ];
      }

      await actions.updateStudent(student.id, updatedDetails);
      addActionLog(`[${user?.role}] Updated profile for ${values.name} (ID: ${student.id})`);
      toast({
        title: "Profile Updated",
        description: `${values.name}'s profile has been updated.`,
      });
      onFinished();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: "An error occurred while saving the profile.",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
         <div className="overflow-y-auto pr-2 flex-grow h-[450px]">
          <div className="space-y-4 pr-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} className="glassmorphic" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {(isDev || isAdmin) && (
              <div className="space-y-2">
                  <FormLabel>Fingerprint IDs</FormLabel>
                   {isAdmin && <p className="text-xs text-destructive">Fingerprint IDs are auto-generated and cannot be edited.</p>}
                  <div className="grid grid-cols-2 gap-4">
                      <FormField
                      control={form.control}
                      name="fingerprint1"
                      render={({ field }) => (
                          <FormItem>
                          <FormControl><Input placeholder="fp1" {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl>
                          <FormMessage />
                          </FormItem>
                      )}
                      />
                      <FormField
                      control={form.control}
                      name="fingerprint2"
                      render={({ field }) => (
                          <FormItem>
                          <FormControl><Input placeholder="fp2" {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl>
                          <FormMessage />
                          </FormItem>
                      )}
                      />
                      <FormField
                      control={form.control}
                      name="fingerprint3"
                      render={({ field }) => (
                          <FormItem>
                          <FormControl><Input placeholder="fp3" {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl>
                          <FormMessage />
                          </FormItem>
                      )}
                      />
                      <FormField
                      control={form.control}
                      name="fingerprint4"
                      render={({ field }) => (
                          <FormItem>
                          <FormControl><Input placeholder="fp4" {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl>
                          <FormMessage />
                          </FormItem>
                      )}
                      />
                  </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="grade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grade</FormLabel>
                    <Select onValueChange={(value) => field.onChange(Number(value))} defaultValue={String(field.value)}>
                        <FormControl>
                            <SelectTrigger className="glassmorphic">
                            <SelectValue placeholder="Select a grade" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {GRADES.map(grade => (
                            <SelectItem key={grade} value={String(grade)}>{grade}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="className"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Class</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                            <SelectTrigger className="glassmorphic">
                            <SelectValue placeholder="Select a class" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {CLASSES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prefect Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="glassmorphic">
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {PREFECT_ROLES.map(role => (
                            <SelectItem key={role} value={role}>{role}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            <FormField
              control={form.control}
              name="contact.phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="xxx xxx xxxx" {...field} className="glassmorphic" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contact.email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input placeholder="example@example.com" {...field} className="glassmorphic" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="specialRoles"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Special Roles</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Hall monitor" {...field} className="glassmorphic"/>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Any relevant notes about the student..." {...field} className="glassmorphic"/>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <DialogFooter className="pt-4 mt-auto">
          <Button type="button" variant="ghost" onClick={onFinished}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}


export function StudentProfileDialog({ student, open, onOpenChange, canEdit, canDelete, canDownload }: StudentProfileDialogProps) {
  const [isClient, setIsClient] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { students } = useStudentStore();
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  
  const isDev = user?.role === 'dev';

  useEffect(() => {
    if(open) {
      setIsClient(true);
    } else {
      setIsEditing(false);
    }
  }, [open]);

  const { attendanceStats, modifiers, modifiersClassNames } = useMemo(() => {
    if (!student) return { attendanceStats: null, modifiers: {}, modifiersClassNames: {} };

    const weekdayRecords = student.attendanceHistory.filter(d => isWeekday(parseDate(d.date)));
    const onTimeRecords = weekdayRecords.filter(d => d.status === 'on time');
    const lateRecords = weekdayRecords.filter(d => d.status === 'late');
    const absentRecords = weekdayRecords.filter(d => d.status === 'absent');
    
    const overallPercentage = calculateAttendancePercentage(student, students);
    const totalWeekdayRecords = weekdayRecords.length;

    const stats = {
      onTimeCount: onTimeRecords.length,
      lateCount: lateRecords.length,
      absentCount: absentRecords.length,
      onTimePercentage: totalWeekdayRecords > 0 ? Math.round((onTimeRecords.length / totalWeekdayRecords) * 100) : 0,
      latePercentage: totalWeekdayRecords > 0 ? Math.round((lateRecords.length / totalWeekdayRecords) * 100) : 0,
      absentPercentage: totalWeekdayRecords > 0 ? Math.round((absentRecords.length / totalWeekdayRecords) * 100) : 0,
      overallPercentage,
    };

    return {
      attendanceStats: stats,
      modifiers: { 
        onTime: student.attendanceHistory.filter(d => d.status === 'on time').map(d => parseDate(d.date)),
        late: student.attendanceHistory.filter(d => d.status === 'late').map(d => parseDate(d.date)),
        absent: student.attendanceHistory.filter(d => d.status === 'absent').map(d => parseDate(d.date)),
      },
      modifiersClassNames: {
        onTime: 'day-on-time',
        absent: 'day-absent',
        late: 'day-late',
      }
    };
  }, [student, students]);

  const handleDownload = async (format: 'csv' | 'pdf') => {
    if (!student) return;
    setIsDownloading(true);
    try {
      let data, fileName;
      
      if (format === 'csv') {
        data = await downloadStudentAttendanceSummaryAsCsvAction(student);
        fileName = `${student.name.replace(/ /g, '_')}_attendance_summary.csv`;
        const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        data = await downloadStudentAttendanceSummaryAsPdfAction(student);
        fileName = `${student.name.replace(/ /g, '_')}_attendance_summary.pdf`;
        const blob = new Blob([Buffer.from(data, 'base64')], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      addActionLog(`[${user?.role}] Downloaded ${fileName}`);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Download failed",
        description: `Could not generate or download the summary file.`,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (!student) return null;
  
  const handleDialogClose = (isOpen: boolean) => {
      if(!isOpen) {
        setIsClient(false);
        setIsEditing(false);
      }
      onOpenChange(isOpen);
  }
  
  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-3xl glassmorphic glowing-border">
        <style>{`
          .day-on-time { background-color: ${statusColors["on time"]}; color: white; border-radius: 999px; }
          .day-absent { background-color: ${statusColors.absent}; color: white; border-radius: 999px; }
          .day-late { background-color: ${statusColors.late}; color: white; border-radius: 999px; }
        `}</style>
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-3xl font-headline text-primary">
                  {student.name}
              </DialogTitle>
              <DialogDescription>
                Grade {student.grade} - Class {student.className} | ID: {student.id}
              </DialogDescription>
            </div>
             {canEdit && !isEditing && (
              <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)}>
                <Pencil className="h-5 w-5" />
                <span className="sr-only">Edit Profile</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {isEditing && canEdit ? (
          <EditStudentForm student={student} onFinished={() => setIsEditing(false)} />
        ) : (
          <Tabs defaultValue="general" className="mt-4">
            <TabsList>
              <TabsTrigger value="general">General Information</TabsTrigger>
              <TabsTrigger value="additional">Additional Information</TabsTrigger>
            </TabsList>
            <div className="h-[400px]">
              <TabsContent value="general" className="h-full overflow-y-auto pr-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <div className="space-y-4">
                    <h3 className="font-headline text-lg text-accent-foreground">Contact & Role</h3>
                    <div className="space-y-3 glassmorphic p-4 rounded-lg">
                      <div className="flex items-center gap-3"><Phone className="h-4 w-4 text-primary" />{student.contact.phone}</div>
                      <div className="flex items-center gap-3"><Mail className="h-4 w-4 text-primary" /> <span className="font-medium">{student.contact.email || 'N/A'}</span></div>
                      {student.role && (
                        <>
                          <Separator />
                          <div className="flex items-center gap-3">
                            <Badge variant="secondary">{student.role}</Badge>
                          </div>
                        </>
                      )}
                    </div>

                    <h3 className="font-headline text-lg text-accent-foreground">Attendance Statistics</h3>
                    {isClient && attendanceStats ? (
                      <div className="space-y-3 glassmorphic p-4 rounded-lg">
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground"><GraduationCap className="h-4 w-4 text-primary" /> Overall Presence</span>
                          <span className="font-bold text-lg">{attendanceStats.overallPercentage}%</span>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <div className="flex justify-between">
                              <span className="flex items-center gap-1.5"><UserCheck className="h-4 w-4 text-green-500" /> On Time</span>
                              <span>{attendanceStats.onTimeCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.onTimePercentage}%</div>
                          <div className="flex justify-between">
                            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-yellow-500" /> Late</span>
                            <span>{attendanceStats.lateCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.latePercentage}%</div>
                          <div className="flex justify-between">
                            <span className="flex items-center gap-1.5"><UserX className="h-4 w-4 text-red-500" /> Absent</span>
                            <span>{attendanceStats.absentCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.absentPercentage}%</div>
                        </div>
                      </div>
                    ) : (
                      <Skeleton className="h-40 w-full" />
                    )}
                     {isDev && (
                        <div className="space-y-2">
                           <h3 className="font-headline text-lg text-accent-foreground">Fingerprint IDs</h3>
                            <div className="glassmorphic p-4 rounded-lg space-y-2 text-sm">
                                {student.fingerprints.map((fp, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <Fingerprint className="h-4 w-4 text-primary"/>
                                        <span className="font-mono text-muted-foreground">{fp || 'Not Set'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-headline text-lg text-accent-foreground mb-2">Attendance Calendar</h3>
                    <div className="p-4 rounded-md glassmorphic">
                      {isClient ? (
                        <Calendar
                          mode="single"
                          selected={new Date()}
                          disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
                          modifiers={modifiers}
                          modifiersClassNames={modifiersClassNames}
                          className="p-0"
                          weekStartsOn={1}
                        />
                      ) : (
                        <Skeleton className="h-[250px] w-full" />
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="additional" className="h-full overflow-y-auto pr-4">
                 <div className="mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                          <h3 className="font-headline text-lg text-accent-foreground">Special Roles</h3>
                          <div className="p-4 glassmorphic rounded-md text-sm text-muted-foreground min-h-[300px]">
                            <p className="whitespace-pre-wrap">{student.specialRoles || "No special roles assigned."}</p>
                          </div>
                      </div>
                      <div className="space-y-2">
                           <h3 className="font-headline text-lg text-accent-foreground">Notes</h3>
                          <div className="p-4 glassmorphic rounded-md text-sm text-muted-foreground min-h-[300px]">
                            <p className="whitespace-pre-wrap">{student.notes || "No notes available."}</p>
                          </div>
                      </div>
                    </div>
                </div>
              </TabsContent>
            </div>
            <DialogFooter className="sm:justify-between items-center mt-4">
                <div />
                <div className="flex items-center gap-2">
                    {canDownload && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleDownload('pdf')} disabled={isDownloading}>
                           {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileIcon className="mr-2 h-4 w-4" />}
                           PDF Report
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownload('csv')} disabled={isDownloading}>
                           {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                           CSV Report
                        </Button>
                      </>
                    )}
                    <RemoveStudentButton student={student} onDeleted={() => onOpenChange(false)} canDelete={canDelete} />
                </div>
            </DialogFooter>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

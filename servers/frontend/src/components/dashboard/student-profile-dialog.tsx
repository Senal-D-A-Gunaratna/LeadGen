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
import { MonthYearSelector } from "@/components/ui/month-year-selector";
import { syncClient } from "@/lib/sync-client";
import type { Student, AttendanceStatus, PrefectRole } from "@/lib/types";
import { Mail, Phone, GraduationCap, Trash2, Loader2, Save, Pencil, UserCheck, Clock, UserX, Edit, Download, FileText, Fingerprint, File as FileIcon, ChevronLeft, ChevronRight, TrendingUp, Calendar as CalendarIcon } from "lucide-react";
import WhatsAppIcon from "@/icons/WhatsAppIcon";
import MiniTrendChart from "@/components/ui/mini-trend-chart";
import { useMemo, useState, useEffect, useRef } from "react";
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
import { GRADES, CLASSES, PREFECT_ROLES } from "@/lib/student-data";
// Use filter lists from the central store (reactive) instead of module-level arrays
import { Badge } from "../ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { parseDate } from "@/lib/utils";
import { format } from "date-fns";
import { getStudentSummary, getStudentById, getStudentMonthlyAttendance, getStudentAttendanceTrend, getAttendanceAggregate, getStaticFilters } from "@/lib/api-client";
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
  weekend: 'hsl(var(--muted-foreground))',
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
    whatsapp: z.string().optional(),
  }),
  specialRoles: z.string().optional(),
  notes: z.string().optional(),
});



function RemoveStudentButton({ student, onDeleted, canDelete }: { student: Student, onDeleted: () => void, canDelete: boolean }) {
  const { actions, availableGrades, availableClasses, availableRoles } = useStudentStore();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [isPending, setIsPending] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  const handleRequestAuth = () => {
    setIsAlertOpen(false); // Close confirmation dialog
    setIsAuthOpen(true);   // Open password dialog
  }

  const handleAuthorizedRemove = async (password?: string) => {
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
              This action will permanently delete {student.name}'s records and requires password authorization
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
  const { actions, availableGrades, availableClasses, availableRoles } = useStudentStore();
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
        whatsapp: (student.contact as any).whatsapp || '',
      },
      specialRoles: student.specialRoles || '',
      notes: student.notes || '',
    },
  });

  // Static option state: fetch latest static lists when the dialog opens
  const [gradeOptions, setGradeOptions] = useState<string[]>(GRADES || []);
  const [classOptions, setClassOptions] = useState<string[]>(CLASSES || []);
  const [roleOptions, setRoleOptions] = useState<PrefectRole[]>(PREFECT_ROLES || []);

  useEffect(() => {
    let mounted = true;
    if (!open) return;
    getStaticFilters().then((resp) => {
      if (!mounted) return;
      if (resp.grades && resp.grades.length) setGradeOptions(resp.grades);
      if (resp.classes && resp.classes.length) setClassOptions(resp.classes);
      if (resp.roles && resp.roles.length) setRoleOptions(resp.roles as PrefectRole[]);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [open]);

  async function onSubmit(values: z.infer<typeof editFormSchema>) {
    setIsPending(true);
    try {
      const updatedDetails: Partial<Omit<Student, 'id'>> = {
        name: values.name,
        grade: values.grade,
        className: values.className,
        contact: {
          email: values.contact.email || '',
          phone: values.contact.phone,
        },
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
         <div className="overflow-y-auto pr-2 flex-grow min-h-[420px]">
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
                   {isAdmin && <p className="text-xs text-destructive">Fingerprint IDs are auto-generated and cannot be edited</p>}
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
                            <SelectTrigger>
                            <SelectValue placeholder="Select a grade" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {gradeOptions.map((grade: string) => (
                            <SelectItem key={String(grade)} value={String(grade)}>{grade}</SelectItem>
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
                            {classOptions.map((c: string) => (
                            <SelectItem key={String(c)} value={String(c)}>{c}</SelectItem>
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
                          {roleOptions.map((role: any) => (
                            <SelectItem key={String(role)} value={String(role)}>{String(role)}</SelectItem>
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
              name="contact.whatsapp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp</FormLabel>
                  <FormControl><Input placeholder="WhatsApp number (optional)" {...field} className="glassmorphic" /></FormControl>
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
                    <Textarea placeholder="Hall monitor" {...field} className="glassmorphic" />
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
                    <Textarea placeholder="Any relevant notes about the student..." {...field} className="glassmorphic" />
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

// Helpers copied from attendance-history-tab to detect whether a month has any attendance data
const computeMonthHasDataFromPoints = (points: any[], month: Date) => {
  if (!points || points.length === 0) return false;
  const startIso = new Date(month.getFullYear(), month.getMonth(), 1).toISOString().slice(0,10);
  const endIso = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString().slice(0,10);
  for (const p of points) {
    const label = p.label || p.date || p[0];
    if (!label) continue;
    // labels are often YYYY-MM-DD for month/week ranges
    if (typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
      if (label >= startIso && label <= endIso) {
        // determine if this point contains any attendance (counts or percent)
        const hasCount = (p.on_time || p.late || p.absent) && ((p.on_time||0) + (p.late||0) + (p.absent||0) > 0);
        const hasPercent = typeof p.percent === 'number' ? (p.percent > 0) : false;
        if (hasCount || hasPercent) return true;
      }
    }
  }
  return false;
};

// Determine whether trend points contain any attendance data
const trendHasData = (points: any[] | null) => {
  if (!points || points.length === 0) return false;
  for (const p of points) {
    const hasCount = (p.on_time || p.late || p.absent) && ((p.on_time || 0) + (p.late || 0) + (p.absent || 0) > 0);
    const hasPercent = typeof p.percent === 'number' ? (p.percent > 0) : false;
    if (hasCount || hasPercent) return true;
  }
  return false;
};

const isMonthWithinRange = (month: Date) => {
  // backend 'month' aggregate covers last ~30 days ending today; consider month has possible data if it overlaps last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 29);
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return monthEnd >= thirtyDaysAgo && monthStart <= today;
};

export function StudentProfileDialog({ student, open, onOpenChange, canEdit, canDelete, canDownload }: StudentProfileDialogProps) {
  const [isClient, setIsClient] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { students, studentSummaries, actions } = useStudentStore();
  const { updateStudentSummaries } = actions;
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  
  const isDev = user?.role === 'dev';

  useEffect(() => {
    if(open) {
      setIsClient(true);
      setDisplayedMonth(new Date());
    } else {
      setIsEditing(false);
    }
  }, [open]);

  

  const [attendanceStats, setAttendanceStats] = useState<any | null>(null);

  // Month aggregate check state (copied logic from attendance-history-tab)
  const [displayedMonth, setDisplayedMonth] = useState<Date>(new Date());
  const [monthHasData, setMonthHasData] = useState<boolean | null>(null); // null = unknown/loading
  const [fetchError, setFetchError] = useState<boolean>(false);
  const fetchTimerRef = useRef<number | null>(null);
  // Trend (line chart) state + cache
  const [showTrend, setShowTrend] = useState<boolean>(true);
  const [trendLoading, setTrendLoading] = useState<boolean>(false);
  const [trendError, setTrendError] = useState<boolean>(false);
  const [attendanceTrend, setAttendanceTrend] = useState<any[] | null>(null);
  const attendanceTrendCache = useRef<Map<string, any[]>>(new Map());
  const [studentMonthlyHistory, setStudentMonthlyHistory] = useState<any[] | null>(null);
  const monthlyHistoryFetchRef = useRef<number | null>(null);

  // Always refresh authoritative student data when opening the profile.
  useEffect(() => {
    if (!open || !student) return;
    (async () => {
      try {
        const year = displayedMonth.getFullYear();
        const monthZero = displayedMonth.getMonth();
        const key = formatTrendKey(student.id, year, monthZero + 1);
        attendanceTrendCache.current.delete(key);
        await fetchAttendanceTrendForMonth(student.id, year, monthZero);

        try {
          const mon = displayedMonth.getMonth() + 1;
          const monthStr = `${displayedMonth.getFullYear()}-${String(mon).padStart(2, '0')}`;
          const resp = await getStudentMonthlyAttendance(student.id, monthStr) as any;
          const hist = resp && Array.isArray(resp.attendanceHistory) ? resp.attendanceHistory : [];
          setStudentMonthlyHistory(hist);
        } catch (e) {
          console.warn('Failed to fetch student monthly attendance on open', e);
          setStudentMonthlyHistory(null);
        }

        try {
          console.debug('[StudentProfile] fetching summary for', student.id);
          const res = await getStudentSummary(student.id);
          console.debug('[StudentProfile] getStudentSummary response', res);
          const s = res?.summary;
          if (s) {
            updateStudentSummaries([{
              studentId: student.id,
              summary: {
                totalSchoolDays: s.totalSchoolDays,
                presentDays: s.presentDays,
                absentDays: s.absentDays,
                onTimeDays: s.onTimeDays,
                lateDays: s.lateDays,
                presencePercentage: s.presencePercentage,
                absencePercentage: s.absencePercentage,
                onTimePercentage: s.onTimePercentage,
                latePercentage: s.latePercentage,
              }
            }]);
            setAttendanceStats({
              onTimeCount: s.onTimeDays,
              lateCount: s.lateDays,
              absentCount: s.absentDays,
              onTimePercentage: s.onTimePercentage,
              latePercentage: s.latePercentage,
              absentPercentage: s.absencePercentage,
              overallPercentage: s.presencePercentage,
              totalSchoolDays: s.totalSchoolDays,
            });
          }
        } catch (e) {
          console.error('Failed to fetch student summary on open', e);
        }
      } catch (e) {
        console.warn('Failed to refresh student profile data on open', e);
      }
    })();
  }, [open, student, displayedMonth]);

  // Single top-level flag indicating whether student monthly history exists
  const hasMonthlyHistory = Array.isArray(studentMonthlyHistory) && studentMonthlyHistory.length > 0;

  // No local websocket connection listeners — profile data is fetched via HTTP
  // and updated via `syncClient` push events elsewhere in this component.

  // Listen to `syncClient` high-level events and refresh the currently
  // displayed student's data (trend, monthly history, summary) when
  // relevant backend changes occur.
  useEffect(() => {
    if (!student) return;

    const tryRefetchForStudent = async (reason?: string, payload?: any) => {
      try {
        const year = displayedMonth.getFullYear();
        const monthZero = displayedMonth.getMonth();
        // Refresh trend
        const key = formatTrendKey(student.id, year, monthZero + 1);
        attendanceTrendCache.current.delete(key);
        await fetchAttendanceTrendForMonth(student.id, year, monthZero);

        // Refresh monthly history
        try {
          const mon = displayedMonth.getMonth() + 1;
          const monthStr = `${displayedMonth.getFullYear()}-${String(mon).padStart(2, '0')}`;
          const resp = await getStudentMonthlyAttendance(student.id, monthStr) as any;
          const hist = resp && Array.isArray(resp.attendanceHistory) ? resp.attendanceHistory : [];
          setStudentMonthlyHistory(hist);
        } catch (e) {
          console.warn('sync refresh: failed to fetch monthly attendance', e);
        }

        // Refresh summary
        try {
          const res = await getStudentSummary(student.id);
          const s = res?.summary;
          if (s) {
            updateStudentSummaries([{
              studentId: student.id,
              summary: {
                totalSchoolDays: s.totalSchoolDays,
                presentDays: s.presentDays,
                absentDays: s.absentDays,
                onTimeDays: s.onTimeDays,
                lateDays: s.lateDays,
                presencePercentage: s.presencePercentage,
                absencePercentage: s.absencePercentage,
                onTimePercentage: s.onTimePercentage,
                latePercentage: s.latePercentage,
              }
            }]);
            setAttendanceStats({
              onTimeCount: s.onTimeDays,
              lateCount: s.lateDays,
              absentCount: s.absentDays,
              onTimePercentage: s.onTimePercentage,
              latePercentage: s.latePercentage,
              absentPercentage: s.absencePercentage,
              overallPercentage: s.presencePercentage,
              totalSchoolDays: s.totalSchoolDays,
            });
          }
        } catch (e) {
          console.warn('sync refresh: failed to fetch student summary', e);
        }
      } catch (e) {
        console.error('sync refresh error', e);
      }
    };

    const handler = (event: string, payload?: any) => {
      try {
        if (!student) return;
        // Events that may affect a student's profile
        if (event === 'student_summary' && payload?.studentId === student.id) {
          tryRefetchForStudent('student_summary', payload);
          return;
        }

        if (event === 'attendance_updated') {
          const ids: number[] = payload?.affectedIds || payload?.data?.affectedIds || [];
          if (ids.length === 0 || ids.includes(student.id)) {
            tryRefetchForStudent('attendance_updated', payload);
          }
          return;
        }

        if (event === 'data_changed') {
          const type = payload?.type || payload?.data?.type || null;
          const ids: number[] = payload?.data?.affectedIds || payload?.affectedIds || [];
          if (type === 'attendance_db_changed' || type === 'attendance_updated' || type === 'student_updated' || type === 'student_added' || type === 'student_removed') {
            tryRefetchForStudent('data_changed', payload);
            return;
          }
          if (Array.isArray(ids) && ids.includes(student.id)) {
            tryRefetchForStudent('data_changed', payload);
            return;
          }
        }

        if (event === 'students_refreshed') {
          const ids: number[] = payload?.students?.map((s: any) => s.id) || [];
          if (ids.includes(student.id)) tryRefetchForStudent('students_refreshed', payload);
        }
      } catch (e) {
        console.error('sync handler error', e);
      }
    };

    try { syncClient.on(handler); } catch (e) {}
    return () => { try { syncClient.off(handler); } catch (e) {} };
  }, [student, displayedMonth]);
  const fetchMonthAggregate = async (month: Date) => {
    if (fetchTimerRef.current) window.clearTimeout(fetchTimerRef.current);
    return new Promise<void>((resolve) => {
      fetchTimerRef.current = window.setTimeout(async () => {
        setMonthHasData(null);
        setFetchError(false);
        try {
          const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
          const resp = await getAttendanceAggregate({ month: monthStr, grade: 'all' });
          const points = (resp && resp.points) ? resp.points : [];
          const has = computeMonthHasDataFromPoints(points, month);
          setMonthHasData(has);
          setFetchError(false);
        } catch (err) {
          console.warn('attendance aggregate fetch failed', err);
          // Do NOT treat socket failure as "no data". Keep calendar usable but mark fetchError.
          setFetchError(true);
          setMonthHasData(true);
        }
        resolve();
      }, 250);
    });
  };

  useEffect(() => {
    if (!isMonthWithinRange(displayedMonth)) {
      setMonthHasData(false);
      setFetchError(false);
      return;
    }
    let mounted = true;
    (async () => {
      await fetchMonthAggregate(displayedMonth);
      if (!mounted) return;
    })();
    const onDataChanged = (payload?: any) => {
      // Only refresh month aggregate for relevant backend events
      try {
        const type = payload?.type || null;
        if (!type) {
          // unknown payload -> safe refresh
          fetchMonthAggregate(displayedMonth);
          return;
        }
        const relevantTypes = ['attendance_db_changed', 'attendance_updated', 'student_updated', 'student_added', 'student_removed'];
        if (relevantTypes.includes(type)) {
          fetchMonthAggregate(displayedMonth);
        }
      } catch (e) {
        // fallback: refresh
        fetchMonthAggregate(displayedMonth);
      }
    };

    const onSummaryUpdate = () => fetchMonthAggregate(displayedMonth);

    // Use centralized sync client for all data/sync events (keeps behaviour consistent)
    const syncListener = (event: string, payload?: any) => {
      try {
        if (event === 'data_changed') {
          onDataChanged(payload);
          return;
        }
        if (event === 'summary_update' || event === 'all_summaries' || event === 'students_refreshed') {
          fetchMonthAggregate(displayedMonth);
          return;
        }
      } catch (e) {
        // fallback: still fetch
        fetchMonthAggregate(displayedMonth);
      }
    };

    try { syncClient.on(syncListener); } catch (e) {}

    return () => {
      mounted = false;
      try { syncClient.off(syncListener); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedMonth]);

  // Fetch attendance trend for currently displayed month (with retries and caching)
  // month here should be 1-12 (use monthOneBased when calling)
  const formatTrendKey = (studentId: number, year: number, monthOneBased: number) => `${studentId}-${year}-${monthOneBased}`;

  const fetchAttendanceTrendForMonth = async (studentId: number, year: number, monthZeroBased: number) => {
    const monthOne = monthZeroBased + 1;
    const key = formatTrendKey(studentId, year, monthOne);
    // Check cache
    const cached = attendanceTrendCache.current.get(key);
    if (cached) {
      setAttendanceTrend(cached);
      setTrendLoading(false);
      setTrendError(false);
      return;
    }

    setTrendLoading(true);
    setTrendError(false);

    try {
      const monthStr = `${year}-${String(monthOne).padStart(2, '0')}`;
      const httpPoints = await getStudentAttendanceTrend(studentId, monthStr);
      const points = (httpPoints || []).map((p: any) => {
        const arrival_ts = p.arrival_ts || null;
        let arrival_minutes: number | null = p.arrival_minutes ?? null;
        let arrival_local: string | null = p.arrival_local ?? null;
        if ((arrival_minutes === null || arrival_minutes === undefined) && arrival_ts) {
          try {
            const d = new Date(arrival_ts * 1000);
            arrival_minutes = d.getHours() * 60 + d.getMinutes();
            arrival_local = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } catch (e) {
            arrival_minutes = null;
            arrival_local = null;
          }
        }
        return { ...p, arrival_minutes, arrival_local };
      });
      attendanceTrendCache.current.set(key, points);
      setAttendanceTrend(points);
      setTrendLoading(false);
      setTrendError(false);
      return;
    } catch (err) {
      console.error('Failed to fetch attendance trend via HTTP', err);
      // Do not fallback to monthly attendance records. Rely only on authoritative
      // API-provided trend (`getStudentAttendanceTrend`). Clear cached value
      // and mark trend as errored so UI shows no-data state instead of fabricated points.
      attendanceTrendCache.current.set(key, []);
      setAttendanceTrend([]);
      setTrendLoading(false);
      setTrendError(true);
      return;
    }
  };

  // Subscribe to server push updates for attendance_trend to update cache
  useEffect(() => {
    // WebSocket pushes are used only as a notification to refresh data.
    // Invalidate the cached HTTP response for the pushed student/month
    // and trigger an HTTP fetch so the frontend always uses authoritative HTTP data.
    const onPush = (data: any) => {
      if (!data || !data.success) return;
      console.debug('attendance_trend push received (invalidating cache)', data);
      const { studentId, year, month } = data;
      const key = formatTrendKey(studentId, year, month);
      attendanceTrendCache.current.delete(key);
      // If the currently opened dialog is viewing this student/month, refetch via HTTP
      if (student && student.id === studentId && year === displayedMonth.getFullYear() && month === (displayedMonth.getMonth() + 1)) {
        // fetchAttendanceTrendForMonth will perform an HTTP fetch (and repopulate cache)
        // month param to fetchAttendanceTrendForMonth expects zero-based month index
        fetchAttendanceTrendForMonth(studentId, year, displayedMonth.getMonth());
      }
    };
    const trendSyncHandler = (event: string, payload?: any) => { if (event === 'attendance_trend') onPush(payload); };
    try { syncClient.on(trendSyncHandler); } catch (e) {}
    return () => { try { syncClient.off(trendSyncHandler); } catch (e) {} };
  }, [student, displayedMonth]);

  useEffect(() => {
    if (!student) return;
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    const monthOne = month + 1;
    const key = formatTrendKey(student.id, year, monthOne);
    // If the dialog was just opened, force a fresh server fetch by clearing cache.
    if (open) {
      attendanceTrendCache.current.delete(key);
    }
    // Always fetch the server-provided attendance trend for the displayed month
    // (calendar should rely only on authoritative server data keyed by student.id)
    fetchAttendanceTrendForMonth(student.id, year, month);
  }, [displayedMonth, student]);

  // Fetch per-student monthly attendanceHistory (date,status) and cache briefly.
  useEffect(() => {
    if (!student) {
      setStudentMonthlyHistory(null);
      return;
    }
    if (monthlyHistoryFetchRef.current) window.clearTimeout(monthlyHistoryFetchRef.current);
    monthlyHistoryFetchRef.current = window.setTimeout(async () => {
      try {
        const mon = displayedMonth.getMonth() + 1;
        const monthStr = `${displayedMonth.getFullYear()}-${String(mon).padStart(2, '0')}`;
        const resp = await getStudentMonthlyAttendance(student.id, monthStr) as any;
        const hist = resp && Array.isArray(resp.attendanceHistory) ? resp.attendanceHistory : [];
        setStudentMonthlyHistory(hist);
      } catch (e) {
        console.warn('Failed to fetch student monthly attendance', e);
        setStudentMonthlyHistory(null);
      }
    }, 120);

    return () => {
      if (monthlyHistoryFetchRef.current) window.clearTimeout(monthlyHistoryFetchRef.current);
    };
  }, [student, displayedMonth]);

  const modifiers = useMemo(() => {
    if (!student) return { onTime: [], late: [], absent: [] };
    // Use ONLY the per-student monthly attendance records for calendar modifiers
    const sourceHist = Array.isArray(studentMonthlyHistory) && studentMonthlyHistory.length > 0
      ? studentMonthlyHistory
      : [];

    if (!sourceHist || sourceHist.length === 0) return { onTime: [], late: [], absent: [] };

    const prefix = format(displayedMonth, 'yyyy-MM');
    const onTime: Date[] = [];
    const late: Date[] = [];
    const absent: Date[] = [];
    for (const r of sourceHist) {
      const label = r?.date || r?.label;
      if (!label || typeof label !== 'string') continue;
      if (!label.startsWith(prefix)) continue;
      try {
        const d = parseDate(label);
        const st = (r?.status || '').toString().trim().toLowerCase();
        if (st === 'on time' || st === 'ontime' || st === 'on_time') {
          onTime.push(d);
        } else if (st === 'late') {
          late.push(d);
        } else if (st === 'absent') {
          absent.push(d);
        } else {
          continue;
        }
      } catch (e) {
        continue;
      }
    }
    return { onTime, late, absent };
  }, [studentMonthlyHistory, displayedMonth]);

  // Do not create 'null' date set — keep all calendar days active (do not dim/disable days)
  // Removed nullDatesSet — calendar will not dim additional dates here

  const modifiersClassNames = {
    onTime: 'day-on-time',
    absent: 'day-absent',
    late: 'day-late',
  };

  // Unified month data detection: consider trend points, per-student monthly history,
  // calendar modifiers (attendance days), aggregate check, and summary counts.
  // Returns: true = has data, false = definitely no data, null = unknown/loading.
  const monthHasAnyData: boolean | null = useMemo(() => {
    // If displayed month is outside the backend range, treat as no data.
    if (!isMonthWithinRange(displayedMonth)) return false;

    // Use per-student monthly history (authoritative) to determine presence
    const prefix = format(displayedMonth, 'yyyy-MM');
    const monthlyPoints = Array.isArray(studentMonthlyHistory)
      ? studentMonthlyHistory.filter((p: any) => typeof (p?.date || p?.label) === 'string' && ( (p.date || p.label) as string).startsWith(prefix) )
      : [];

    const hasTrend = monthlyPoints.length > 0;

    const modOnTime = Array.isArray(modifiers.onTime) ? modifiers.onTime.length : 0;
    const modLate = Array.isArray(modifiers.late) ? modifiers.late.length : 0;
    const modAbsent = Array.isArray(modifiers.absent) ? modifiers.absent.length : 0;
    const hasModifiers = (modOnTime + modLate + modAbsent) > 0;

    // use top-level `hasMonthlyHistory` (defined below) instead of re-declaring here

    const summaryCount = (attendanceStats && ((attendanceStats.onTimeCount || 0) + (attendanceStats.lateCount || 0) + (attendanceStats.absentCount || 0))) || 0;
    const hasSummary = summaryCount > 0;

    // If the per-student monthly record or other modifiers report data, we have data.
    if (hasTrend || hasModifiers || hasMonthlyHistory || hasSummary || monthHasData === true) return true;

    // If fetch reported an error, avoid treating that as "no data" — return unknown so UI can avoid a false no-data view.
    if (fetchError) return null;

    // If month aggregate is still loading (null) or trend is loading, return unknown.
    if (monthHasData === null || trendLoading) return null;

    // No sources report data and nothing is loading — definite no data.
    return false;
  }, [hasMonthlyHistory, modifiers, monthHasData, fetchError, attendanceStats, displayedMonth]);

  // Build trend points from per-student monthly attendance records only
  const monthlyTrendPoints = useMemo(() => {
    if (!Array.isArray(studentMonthlyHistory) || studentMonthlyHistory.length === 0) return [];
    const prefix = format(displayedMonth, 'yyyy-MM');
    const pts: any[] = [];
    for (const r of studentMonthlyHistory) {
      const label = r?.date || r?.label;
      if (!label || typeof label !== 'string') continue;
      if (!label.startsWith(prefix)) continue;
      const status = (r?.status || '').toString().trim().toLowerCase();
      const point: any = { date: label };
      if (status === 'on time' || status === 'ontime' || status === 'on_time') point.on_time = 1;
      else if (status === 'late') point.late = 1;
      else if (status === 'absent') point.absent = 1;

      // arrival minutes: prefer explicit field, then arrival_ts (seconds)
      if (typeof r.arrival_minutes === 'number') {
        point.arrival_minutes = r.arrival_minutes;
      } else if (r.arrival_ts) {
        try {
          const d = new Date(r.arrival_ts * 1000);
          point.arrival_minutes = d.getHours() * 60 + d.getMinutes();
          point.arrival_local = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
          point.arrival_minutes = null;
          point.arrival_local = null;
        }
      } else {
        point.arrival_minutes = null;
        point.arrival_local = null;
      }

      pts.push(point);
    }
    return pts;
  }, [studentMonthlyHistory, displayedMonth]);

  
  useEffect(() => {
    let cancelled = false;
    async function fetchSummary() {
      if (!student) return setAttendanceStats(null);
      const summary = studentSummaries.get(student.id);
      if (summary) {
        setAttendanceStats({
          onTimeCount: summary.onTimeDays,
          lateCount: summary.lateDays,
          absentCount: summary.absentDays,
          onTimePercentage: summary.onTimePercentage,
          latePercentage: summary.latePercentage,
          absentPercentage: summary.absencePercentage,
          overallPercentage: summary.presencePercentage,
          totalSchoolDays: summary.totalSchoolDays,
        });
      } else {
        // Fetch and update store
        try {
          console.debug('[StudentProfile] fetchSummary() calling getStudentSummary for', student?.id);
          const res = await getStudentSummary(student.id);
          console.debug('[StudentProfile] fetchSummary() getStudentSummary response', res);
          const s = res?.summary;
          if (!cancelled && s) {
            // Update the store with the fetched summary
            updateStudentSummaries([{
              studentId: student.id,
              summary: {
                totalSchoolDays: s.totalSchoolDays,
                presentDays: s.presentDays,
                absentDays: s.absentDays,
                onTimeDays: s.onTimeDays,
                lateDays: s.lateDays,
                presencePercentage: s.presencePercentage,
                absencePercentage: s.absencePercentage,
                onTimePercentage: s.onTimePercentage,
                latePercentage: s.latePercentage,
              }
            }]);
            setAttendanceStats({
              onTimeCount: s.onTimeDays,
              lateCount: s.lateDays,
              absentCount: s.absentDays,
              onTimePercentage: s.onTimePercentage,
              latePercentage: s.latePercentage,
              absentPercentage: s.absencePercentage,
              overallPercentage: s.presencePercentage,
              totalSchoolDays: s.totalSchoolDays,
            });
          }
        } catch (e) {
          console.error('Failed to fetch student summary', e);
          if (!cancelled) setAttendanceStats(null);
        }
      }
    }

    fetchSummary();
    const syncListener = (event: string, payload?: any) => {
      try {
        if (!student) return;
        if (event === 'student_summary' && payload?.studentId === student.id) {
          fetchSummary();
        }
        if (event === 'attendance_updated') {
          const ids: number[] = payload?.affectedIds || payload?.data?.affectedIds || [];
          if (ids.length === 0) {
            // Generic attendance update — refresh this student's data
            const year = displayedMonth.getFullYear();
            const monthZero = displayedMonth.getMonth();
            fetchAttendanceTrendForMonth(student.id, year, monthZero);
            fetchSummary();
          } else if (ids.includes(student.id)) {
            const year = displayedMonth.getFullYear();
            const monthZero = displayedMonth.getMonth();
            fetchAttendanceTrendForMonth(student.id, year, monthZero);
            fetchSummary();
          }
        }
        if (event === 'data_changed') {
          const type = payload?.type || payload?.data?.type || null;
          // If the data_changed indicates attendance DB recalculation or other
          // attendance-related events, refresh the summary and trend.
          if (type === 'attendance_db_changed' || type === 'attendance_updated' || type === 'student_updated' || type === 'student_added' || type === 'student_removed') {
            const year = displayedMonth.getFullYear();
            const monthZero = displayedMonth.getMonth();
            fetchAttendanceTrendForMonth(student.id, year, monthZero);
            fetchSummary();
          } else {
            // If payload contains affectedIds, check membership
            const ids: number[] = payload?.data?.affectedIds || [];
            if (ids.includes(student.id)) {
              const year = displayedMonth.getFullYear();
              const monthZero = displayedMonth.getMonth();
              fetchAttendanceTrendForMonth(student.id, year, monthZero);
              fetchSummary();
            }
          }
        }
      } catch (e) {}
    };

    try { syncClient.on(syncListener); } catch (e) {}

    return () => { cancelled = true; try { syncClient.off(syncListener); } catch (e) {} };
  }, [student, studentSummaries, updateStudentSummaries]);

  

  // Listen for server summary updates and refresh the displayed student summary
  useEffect(() => {
    if (!student) return;
    const handler = (data: { summaries: any[] }) => {
      try {
        if (!data || !Array.isArray(data.summaries)) return;
        const found = data.summaries.find((s: any) => s.studentId === student.id);
        if (!found || !found.summary) return;
        const s = found.summary;
        setAttendanceStats({
          onTimeCount: s.onTimeDays,
          lateCount: s.lateDays,
          absentCount: s.absentDays,
          onTimePercentage: s.onTimePercentage,
          latePercentage: s.latePercentage,
          absentPercentage: s.absencePercentage,
          overallPercentage: s.presencePercentage,
          totalSchoolDays: s.totalSchoolDays,
        });
      } catch (e) {
        console.error('summary_update handler error', e);
      }
    };

    const summarySyncHandler = (event: string, payload?: any) => { if (event === 'summary_update') handler(payload); };
    try { syncClient.on(summarySyncHandler); } catch (e) {}
    return () => { try { syncClient.off(summarySyncHandler); } catch (e) {} };
  }, [student]);

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
            <div className="flex items-center gap-2">
              {canEdit && !isEditing && (
                <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-5 w-5" />
                  <span className="sr-only">Edit Profile</span>
                </Button>
              )}
            </div>
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
            <div className="min-h-[420px]">
              <TabsContent value="general" className="h-full overflow-y-auto pr-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <div className="space-y-4">
                    <h3 className="font-headline text-lg text-accent-foreground">Contact & Role</h3>
                    <div className="space-y-3 p-4 rounded-lg glassmorphic">
                      {student.role && (
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary">{student.role}</Badge>
                        </div>
                      )}
                      {student.role && <Separator />}
                      <div className="flex items-center gap-3"><Phone className="h-4 w-4 text-primary" />{student.contact.phone}</div>
                      { (student.contact as any).whatsapp ? (
                        <div className="flex items-center gap-3">
                          <WhatsAppIcon className="h-4 w-4" />
                          <span className="font-medium">{(student.contact as any).whatsapp}</span>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-3"><Mail className="h-4 w-4 text-primary" /> <span className="font-medium">{student.contact.email || 'N/A'}</span></div>
                    </div>

                    <h3 className="font-headline text-lg text-accent-foreground">Attendance Statistics</h3>
                      {isClient && attendanceStats ? (
                      <div className="space-y-2 px-4 pt-3 pb-0.5 rounded-lg min-h-[180px] glassmorphic">
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground"><GraduationCap className="h-4 w-4 text-primary" /> Overall Presence</span>
                          <span className="font-bold text-lg">{attendanceStats.overallPercentage.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center text-sm text-muted-foreground">
                          <span className="flex items-center gap-2"><CalendarIcon className="h-4 w-4 text-primary" /> School Days</span>
                          <span className="font-semibold">{attendanceStats.totalSchoolDays ?? '—'}</span>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <div className="flex justify-between">
                              <span className="flex items-center gap-1.5"><UserCheck className="h-4 w-4 text-green-500" /> On Time</span>
                              <span>{attendanceStats.onTimeCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.onTimePercentage.toFixed(1)}%</div>
                          <div className="flex justify-between">
                            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-yellow-500" /> Late</span>
                            <span>{attendanceStats.lateCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.latePercentage.toFixed(1)}%</div>
                          <div className="flex justify-between">
                            <span className="flex items-center gap-1.5"><UserX className="h-4 w-4 text-red-500" /> Absent</span>
                            <span>{attendanceStats.absentCount} days</span>
                          </div>
                          <div className="text-right text-muted-foreground">{attendanceStats.absentPercentage.toFixed(1)}%</div>
                        </div>
                      </div>
                    ) : (
                      <Skeleton className="h-40 w-full" />
                    )}
                     {isDev && (
                        <div className="space-y-2">
                           <h3 className="font-headline text-lg text-accent-foreground">Fingerprint IDs</h3>
                            <div className="p-4 rounded-lg space-y-2 text-sm glassmorphic">
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
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-headline text-lg text-accent-foreground">{showTrend ? 'Attendance Line Graph' : 'Attendance Calendar'}</h3>
                      <Button variant="ghost" size="icon" onClick={() => setShowTrend(s => !s)} aria-pressed={showTrend} aria-label={showTrend ? 'Show calendar' : 'Show trend'}>
                        {showTrend ? <CalendarIcon className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                      </Button>
                    </div>
                      {isClient ? (
                        <div className="p-4 rounded-md relative glassmorphic">
                          <MonthYearSelector
                            displayedMonth={displayedMonth}
                            onMonthChange={setDisplayedMonth}
                            showYearSelector={true}
                            disableFutureMonths={true}
                          />

                          <div className="w-full h-[250px] mt-2">
                            {studentMonthlyHistory === null ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Skeleton className="h-full w-full" />
                              </div>
                            ) : (!hasMonthlyHistory || monthHasAnyData === false) ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-full h-full p-3 rounded-md text-center text-muted-foreground flex flex-col items-center justify-center">
                                  <div className="text-lg font-semibold mb-1">No Data Available</div>
                                  <div className="text-sm">There is no attendance data for this month</div>
                                </div>
                              </div>
                            ) : showTrend ? (
                              <div className="w-full h-full">
                                <MiniTrendChart points={monthlyTrendPoints} statusColors={statusColors} />
                              </div>
                            ) : (
                              <div className="w-full h-[250px] flex items-center justify-center px-2">
                                <div className="flex justify-center w-full max-w-[500px]">
                                  <Calendar
                                    mode="single"
                                    month={displayedMonth}
                                    onMonthChange={(m) => setDisplayedMonth(m)}
                                    selected={new Date()}
                                    classNames={{ caption: 'hidden', caption_label: 'hidden', nav: 'hidden', table: 'w-full', head_cell: 'w-full h-8 text-muted-foreground font-normal text-sm', cell: 'w-full h-8' }}
                                    disabled={(date) => {
                                      const isOutOfRange = date > new Date() || date < new Date("2000-01-01");
                                      const day = date.getDay();
                                      const isWeekend = day === 0 || day === 6;
                                      return isOutOfRange || isWeekend;
                                    }}
                                    modifiers={modifiers}
                                    modifiersClassNames={modifiersClassNames}
                                    className="w-full p-0"
                                    weekStartsOn={1}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                       ) : (
                         <Skeleton className="h-[250px] w-full" />
                       )}
                   </div>
                 </div>
               </TabsContent>
               <TabsContent value="additional" className="h-full overflow-y-auto pr-4">
                 <div className="mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                          <h3 className="font-headline text-lg text-accent-foreground">Special Roles</h3>
                          <div className="p-4 rounded-md text-sm text-muted-foreground min-h-[378px] glassmorphic">
                            <p className="whitespace-pre-wrap">{student.specialRoles || "No special roles assigned."}</p>
                          </div>
                      </div>
                      <div className="space-y-2">
                           <h3 className="font-headline text-lg text-accent-foreground">Notes</h3>
                          <div className="p-4 rounded-md text-sm text-muted-foreground min-h-[378px] glassmorphic">
                            <p className="whitespace-pre-wrap">{student.notes || "No notes available."}</p>
                          </div>
                      </div>
                    </div>
                </div>
              </TabsContent>
            </div>
            <DialogFooter className="sm:justify-between items-center mt-1">
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

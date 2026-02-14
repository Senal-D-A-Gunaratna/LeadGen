
"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useStudentStore } from "@/hooks/use-student-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { NewStudent, PrefectRole } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { PREFECT_ROLES, CLASSES, GRADES } from "@/lib/student-data";
import { wsClient } from "@/lib/websocket-client";
import { Textarea } from "../ui/textarea";
import { useAuthStore } from "@/hooks/use-auth-store";

const formSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  grade: z.coerce.number().min(6, { message: "Grade must be between 6 and 13." }).max(13, { message: "Grade must be between 6 and 13." }),
  className: z.string().min(1, { message: "Class is required." }),
  role: z.string().optional(),
  contact: z.object({
    email: z.string().email({ message: "Invalid email address." }).optional().or(z.literal('')),
    phone: z.string().length(10, { message: "Phone number must be exactly 10 digits." }),
  }),
  specialRoles: z.string().optional(),
  notes: z.string().optional(),
  fingerprint1: z.string().optional(),
  fingerprint2: z.string().optional(),
  fingerprint3: z.string().optional(),
  fingerprint4: z.string().optional(),
});

interface AddStudentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}



export function AddStudentForm({ open, onOpenChange }: AddStudentFormProps) {
  const [isPending, setIsPending] = useState(false);
  const { actions, fullRoster, availableGrades: availableGradesFromStore, availableClasses: availableClassesFromStore, availableRoles: availableRolesFromStore } = useStudentStore();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const isDev = user?.role === 'dev';
  const isAdmin = user?.role === 'admin';

  const nextFingerprintIds = useMemo(() => {
    const studentCount = fullRoster.length;
    return [
      `#${studentCount * 4 + 1}`,
      `#${studentCount * 4 + 2}`,
      `#${studentCount * 4 + 3}`,
      `#${studentCount * 4 + 4}`,
    ];
  }, [fullRoster]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      grade: 10,
      className: "Nena",
      role: "none",
      contact: {
        email: "",
        phone: "",
      },
      specialRoles: "",
      notes: "",
      fingerprint1: nextFingerprintIds[0],
      fingerprint2: nextFingerprintIds[1],
      fingerprint3: nextFingerprintIds[2],
      fingerprint4: nextFingerprintIds[3],
    },
  });

  // Keep default values in sync when `nextFingerprintIds` changes
  useEffect(() => {
    form.reset({
      ...form.getValues(),
      fingerprint1: nextFingerprintIds[0],
      fingerprint2: nextFingerprintIds[1],
      fingerprint3: nextFingerprintIds[2],
      fingerprint4: nextFingerprintIds[3],
    })
  }, [nextFingerprintIds]);

  // Static option state: fetch latest static lists when the dialog opens
  const [gradeOptions, setGradeOptions] = useState<string[]>(GRADES || []);
  const [classOptions, setClassOptions] = useState<string[]>(CLASSES || []);
  const [roleOptions, setRoleOptions] = useState<PrefectRole[]>(PREFECT_ROLES || []);

  useEffect(() => {
    let mounted = true;
    if (!open) return;
    wsClient.getStaticFilters().then((resp) => {
      if (!mounted) return;
      if (resp.grades && resp.grades.length) setGradeOptions(resp.grades);
      if (resp.classes && resp.classes.length) setClassOptions(resp.classes);
      if (resp.roles && resp.roles.length) setRoleOptions(resp.roles as PrefectRole[]);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [open]);


  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsPending(true);
    try {
        const studentData: NewStudent = {
          name: values.name,
          grade: values.grade,
          className: values.className,
          role: values.role === 'none' || values.role === '' ? undefined : (values.role as PrefectRole | undefined),
          contact: {
            email: values.contact.email || '',
            phone: values.contact.phone,
          },
          specialRoles: values.specialRoles,
          notes: values.notes,
          fingerprints: [
            values.fingerprint1 || '',
            values.fingerprint2 || '',
            values.fingerprint3 || '',
            values.fingerprint4 || ''
          ],
        }

        await actions.addStudent(studentData);
        toast({
            title: "Student Added",
            description: `${values.name} has been added to the database.`,
        });
        form.reset();
        onOpenChange(false);
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Failed to add student",
            description: "An unexpected error occurred while saving the new student.",
        });
        console.error(error);
    } finally {
        setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl glassmorphic glowing-border" hideCloseButton>
        <DialogHeader className="text-center">
          <DialogTitle className="font-headline text-primary">Add New Student</DialogTitle>
          <DialogDescription>
             Enter the details for the new student below, Fingerprint IDs are generated automatically but can be manually set by a Developer
          </DialogDescription>
        </DialogHeader>
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
                      <FormControl>
                        <Input placeholder="Jaxon Ryker" {...field} className="glassmorphic"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                              {gradeOptions.map(grade => (
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
                              {classOptions.map(c => (
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
                      <FormControl>
                        <Input placeholder="xxx xxx xxxx" {...field} className="glassmorphic"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="contact.email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="example@example.com" {...field} className="glassmorphic"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(isDev || isAdmin) && (
                  <div className="space-y-2">
                      <FormLabel>Fingerprint IDs {isDev ? "(Editable)" : "(Read-only)"}</FormLabel>
                      {isAdmin && <p className="text-xs text-destructive">Fingerprint IDs are auto-generated and cannot be edited</p>}
                      <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="fingerprint1" render={({ field }) => (
                              <FormItem><FormControl><Input {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name="fingerprint2" render={({ field }) => (
                              <FormItem><FormControl><Input {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name="fingerprint3" render={({ field }) => (
                              <FormItem><FormControl><Input {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name="fingerprint4" render={({ field }) => (
                              <FormItem><FormControl><Input {...field} className="glassmorphic disabled:cursor-not-allowed" readOnly={!isDev} disabled={!isDev} /></FormControl><FormMessage /></FormItem>
                          )} />
                      </div>
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="specialRoles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Special Roles (Optional)</FormLabel>
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
                      <FormLabel>Notes (Optional)</FormLabel>
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
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</>
                ) : (
                  "Add Student"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

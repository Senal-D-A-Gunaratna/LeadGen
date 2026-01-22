
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, UserPlus, Upload, Loader2, Download, Database, FileText, History, Users, X, File as FileIcon } from "lucide-react";
import { useStudentStore } from "@/hooks/use-student-store";
import type { Student } from "@/lib/types";
import { Badge } from "../ui/badge";
import { useState, useRef, useEffect } from "react";
import { Button } from "../ui/button";
import { AddStudentForm } from "../dashboard/add-student-form";
import { useAuthStore } from "@/hooks/use-auth-store";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { 
  uploadStudentDataFromCsvAction, 
  downloadStudentDataAsCsvAction,
  uploadAttendanceHistoryFromCsvAction,
  downloadAttendanceSummaryAsCsvAction,
  downloadDetailedAttendanceHistoryAsCsvAction,
  downloadStudentDataAsPdfAction,
  downloadAttendanceSummaryAsPdfAction,
  createBackupAction,
  downloadBackupAction,
  restoreBackupAction,
} from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator } from "../ui/dropdown-menu";
// Use reactive store lists (`useStudentStore`) instead of importing static arrays
import { format } from "date-fns";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { UploadAuthDialog } from "../dashboard/upload-auth-dialog";

type UploadType = 'student-db' | 'student-csv' | 'attendance-db' | 'attendance-csv';
type DownloadType = 'student-db' | 'student-csv' | 'student-pdf' | 'attendance-summary-csv' | 'attendance-db' | 'attendance-detailed-csv' | 'attendance-summary-pdf';

 

export function ManagePrefectsTab() {
  const { 
    students,
    isLoading,
    searchQuery, 
    gradeFilter, 
    classFilter, 
    roleFilter, 
    actions, 
    fakeDate, 
    availableGrades: availableGradesFromStore,
    availableClasses: availableClassesFromStore,
    availableRoles: availableRolesFromStore,
  } = useStudentStore();
  const { 
    setSearchQuery, 
    selectStudent, 
    setGradeFilter, 
    setClassFilter, 
    setRoleFilter, 
    getCurrentAppTime,
    fetchAndSetStudents,
  } = actions;

  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploadAuthOpen, setIsUploadAuthOpen] = useState(false);
  const [uploadType, setUploadType] = useState<UploadType | null>(null);
  const { user } = useAuthStore();
  const { toast } = useToast();
  const { addActionLog } = useActionLogStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdminOrDev = !!user && (user.role === 'admin' || user.role === 'dev');
  const isModerator = user?.role === 'moderator';

  useEffect(() => {
    // On this tab, we don't care about date or status, so we pass null
    actions.setSelectedDate(undefined); 
    actions.setStatusFilter(null);
    fetchAndSetStudents();
  }, []);

  // Global handler clears filters on tab change; no per-tab cleanup here.


  const filteredStudents = students;

  const availableGrades = availableGradesFromStore || [];
  const availableClasses = availableClassesFromStore || [];
  const availableRoles = availableRolesFromStore || [];

  const handleUploadClick = (type: UploadType) => {
    if (isAdminOrDev) {
      setUploadType(type);
      setIsUploadAuthOpen(true);
    }
  };

  const handleAuthenticatedUpload = async (password: string) => {
    setIsUploadAuthOpen(false); // Close auth dialog
    const file = fileInputRef.current?.files?.[0];
    
    if (!file || !uploadType || !user?.role) return;

    setIsUploading(true);

    try {
      if (uploadType === 'student-db' || uploadType === 'attendance-db') {
        // Handle DB Upload (Binary)
        const dataType = uploadType === 'student-db' ? 'students' : 'attendance';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dataType', dataType);

        const response = await fetch('/api/upload-backup', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) throw new Error('Upload failed');
        const data = await response.json();

        if (data.success && data.filename) {
          await restoreBackupAction(dataType, data.filename);
          addActionLog(`[${user?.role}] Restored ${dataType} from upload: ${file.name}`);
          toast({ title: "Restore Successful", description: "Database restored from uploaded file." });
          fetchAndSetStudents();
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      } else {
        // Handle CSV Upload (Text)
        const content = await file.text();
        const now = await getCurrentAppTime();
        const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
        let result;

        if (uploadType === 'student-csv') {
          result = await uploadStudentDataFromCsvAction(content, timestamp, !!fakeDate, user.role, password);
        } else if (uploadType === 'attendance-csv') {
          result = await uploadAttendanceHistoryFromCsvAction(content, timestamp, !!fakeDate, user.role, password);
        }

        if (result?.success) {
          addActionLog(`[${user?.role}] Uploaded ${uploadType}: ${file.name}`);
          toast({ title: "Upload Successful", description: result.message });
          fetchAndSetStudents();
        } else {
          throw new Error(result?.message || "Invalid upload type or failure");
        }
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Failed", description: error.message });
    } finally {
      setIsUploading(false);
      setUploadType(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Now this just triggers the auth flow
    if (event.target.files?.[0]) {
      setIsUploadAuthOpen(true);
    }
  };

  const handleDownloadClick = async (type: DownloadType) => {
    setIsDownloading(true);
    try {
      let data: any;
      let filename: string;
      let mimeType: string;
      let isPdf = false;
      
      const now = await getCurrentAppTime();
      const timestamp = format(now, "yyyy-MM-dd'T'HH-mm-ss");
      
      switch (type) {
        case 'student-csv':
          data = await downloadStudentDataAsCsvAction();
          filename = 'student-data.csv';
          mimeType = 'text/csv;charset=utf-8;';
          break;
        case 'student-db':
          filename = await createBackupAction('students', timestamp, !!fakeDate);
          data = await downloadBackupAction('students', filename);
          mimeType = 'application/x-sqlite3';
          break;
        case 'student-pdf':
          data = await downloadStudentDataAsPdfAction();
          filename = 'student-data.pdf';
          mimeType = 'application/pdf';
          isPdf = true;
          break;
        case 'attendance-db':
          filename = await createBackupAction('attendance', timestamp, !!fakeDate);
          data = await downloadBackupAction('attendance', filename);
          mimeType = 'application/x-sqlite3';
          break;
        case 'attendance-summary-csv':
          data = await downloadAttendanceSummaryAsCsvAction();
          filename = 'attendance-summary.csv';
          mimeType = 'text/csv;charset=utf-8;';
          break;
        case 'attendance-summary-pdf':
          data = await downloadAttendanceSummaryAsPdfAction();
          filename = 'attendance-summary.pdf';
          mimeType = 'application/pdf';
          isPdf = true;
          break;
        case 'attendance-detailed-csv':
            data = await downloadDetailedAttendanceHistoryAsCsvAction();
            filename = 'attendance-history.csv';
            mimeType = 'text/csv;charset=utf-8;';
            break;
        default:
          throw new Error("Invalid download type");
      }

      const blob = isPdf ? new Blob([Buffer.from(data as string, 'base64')], { type: mimeType }) : new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      addActionLog(`[${user?.role}] Downloaded ${filename}.`);
      toast({
        title: "Download Started",
        description: `Your ${filename} file is downloading.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: "Could not download the requested data file.",
      });
    } finally {
      setIsDownloading(false);
    }
  };


  return (
    <>
    <Card className="glassmorphic glowing-border min-h-[750px]">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline text-primary mb-1">Manage Students</CardTitle>
                <CardDescription>
                Add, edit, and manage student roles. Click a student to see more.
                </CardDescription>
            </div>
             <div className="flex items-center gap-2">
                 {(isAdminOrDev || isModerator) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" className="shrink-0" variant="outline" disabled={isDownloading}>
                        {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        <span className="sr-only">Download Data</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Users className="mr-2 h-4 w-4" />
                          <span>Student Data</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                           <DropdownMenuItem onClick={() => handleDownloadClick('student-pdf')}>
                              <FileIcon className="mr-2 h-4 w-4" />
                              <span>PDF File</span>
                            </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDownloadClick('student-csv')}>
                            <FileText className="mr-2 h-4 w-4" />
                            <span>CSV File</span>
                          </DropdownMenuItem>
                          {isAdminOrDev && (
                            <DropdownMenuItem onClick={() => handleDownloadClick('student-db')}>
                              <Database className="mr-2 h-4 w-4" />
                              <span>SQLite File</span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                         <DropdownMenuSubTrigger>
                            <History className="mr-2 h-4 w-4" />
                            <span>Attendance History</span>
                         </DropdownMenuSubTrigger>
                         <DropdownMenuSubContent>
                           <DropdownMenuItem onClick={() => handleDownloadClick('attendance-summary-pdf')}>
                              <FileIcon className="mr-2 h-4 w-4" />
                              <span>Summary PDF</span>
                            </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => handleDownloadClick('attendance-summary-csv')}>
                              <FileText className="mr-2 h-4 w-4" />
                              <span>Summary CSV</span>
                            </DropdownMenuItem>
                           {isAdminOrDev && (
                            <>
                             <DropdownMenuItem onClick={() => handleDownloadClick('attendance-detailed-csv')}>
                                <FileText className="mr-2 h-4 w-4" />
                                <span>CSV File</span>
                              </DropdownMenuItem>
                             <DropdownMenuItem onClick={() => handleDownloadClick('attendance-db')}>
                                <Database className="mr-2 h-4 w-4" />
                                <span>SQLite File</span>
                             </DropdownMenuItem>
                            </>
                           )}
                         </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                 )}
                 {isAdminOrDev && (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleFileChange}
                      accept={uploadType?.includes('csv') ? '.csv' : '.db,.sqlite'}
                      key={uploadType} // Force re-render to apply accept attribute
                    />

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" className="shrink-0" variant="outline" disabled={isUploading}>
                          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          <span className="sr-only">Upload Data</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                             <Users className="mr-2 h-4 w-4" />
                             <span>Student Data</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => handleUploadClick('student-db')}>
                              <Database className="mr-2 h-4 w-4" />
                              <span>SQLite File</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleUploadClick('student-csv')}>
                              <FileText className="mr-2 h-4 w-4" />
                              <span>CSV File</span>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                           <DropdownMenuSubTrigger>
                              <History className="mr-2 h-4 w-4" />
                              <span>Attendance History</span>
                           </DropdownMenuSubTrigger>
                           <DropdownMenuSubContent>
                             <DropdownMenuItem onClick={() => handleUploadClick('attendance-db')}>
                                <Database className="mr-2 h-4 w-4" />
                                <span>SQLite File</span>
                             </DropdownMenuItem>
                             <DropdownMenuItem onClick={() => handleUploadClick('attendance-csv')}>
                                <FileText className="mr-2 h-4 w-4" />
                                <span>CSV File</span>
                             </DropdownMenuItem>
                           </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button onClick={() => setIsAddStudentOpen(true)} size="icon" className="shrink-0">
                        <UserPlus className="h-4 w-4" />
                        <span className="sr-only">Add Student</span>
                    </Button>
                  </>
                 )}
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 w-full mb-4">
            <div className="relative flex-grow">
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
            <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="glassmorphic w-[140px]">
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
              <SelectTrigger className="glassmorphic w-[140px]">
                <SelectValue placeholder="Filter by class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {availableClasses.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
             <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="glassmorphic w-[180px]">
                    <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                     <SelectItem value="none">No Role</SelectItem>
                    {availableRoles.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Total Number Of Students: {filteredStudents.length}
        </p>
        <div className="max-h-[600px] overflow-y-auto pr-2">
            {isLoading ? (
               <div className="flex justify-center items-center h-96">
                 <Loader2 className="h-8 w-8 animate-spin text-primary" />
               </div>
            ) : (
              <Table>
                  <TableHeader>
                      <TableRow className="border-border/40 hover:bg-muted/60">
                          <TableHead>Student</TableHead>
                          <TableHead>Grade</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Role</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {filteredStudents.map((student) => (
                      <TableRow key={student.id} onClick={() => selectStudent(student as Student)} className="cursor-pointer border-border/40 hover:bg-muted/60 transition-all duration-300 hover:scale-[1.01]">
                          <TableCell>
                          <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10 border-2 border-primary/50">
                                  <AvatarFallback>{student.name.charAt(0).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <div className="font-medium">{student.name}</div>
                          </div>
                          </TableCell>
                          <TableCell>{student.grade} - {student.className}</TableCell>
                          <TableCell>
                              <div className="font-medium">{student.contact.phone || 'N/A'}</div>
                          </TableCell>
                          <TableCell>
                            {student.role ? (
                               <Badge variant="secondary">{student.role}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">No role assigned</span>
                            )}
                          </TableCell>
                      </TableRow>
                      ))}
                  </TableBody>
              </Table>
            )}
        </div>
      </CardContent>
    </Card>
    <AddStudentForm open={isAddStudentOpen} onOpenChange={setIsAddStudentOpen} />
    {isAdminOrDev && user && (
        <UploadAuthDialog
            role={user.role}
            open={isUploadAuthOpen}
            onOpenChange={setIsUploadAuthOpen}
            onSuccess={handleAuthenticatedUpload}
        />
     )}
    </>
  );
}

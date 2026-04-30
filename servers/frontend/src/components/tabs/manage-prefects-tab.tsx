"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableRow, TableCell, TableHeader, TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStudentStore } from "@/hooks/use-student-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useToast } from "@/hooks/use-toast";
import { getStudentId } from "@/lib/utils";
import type { Student } from "@/lib/types";
import { Plus, Download, Loader2, Upload, ChevronDown, Search, X } from "lucide-react";
import { AddStudentForm } from "@/components/dashboard/add-student-form";
import { UploadAuthDialog } from "@/components/dashboard/upload-auth-dialog";
import { useActionLogStore } from "@/hooks/use-action-log-store";

export function ManagePrefectsTab() {
  const { students, searchQuery, gradeFilter, classFilter, roleFilter, availableGrades = [], availableClasses = [], availableRoles = [] } = useStudentStore();
  const { selectStudent, setSearchQuery, setGradeFilter, setClassFilter, setRoleFilter, fetchAndSetStudents } = useStudentStore((state) => state.actions);
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAuthOpen, setUploadAuthOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<{ file: File; type: string } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const dbStudentInputRef = useRef<HTMLInputElement>(null);
  const dbAttendanceInputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => students || [], [students]);

  const isAdmin = user?.role === 'admin';
  const isDev = user?.role === 'dev';
  const canEdit = isAdmin || isDev;


  const handleRowClick = useCallback((student: Student) => {
    if (canEdit) {
      selectStudent(student);
    }
  }, [canEdit, selectStudent]);

  // Re-fetch the filtered student list whenever the search query changes.
  // This ensures the backend applies the query filter and the UI renders the updated list.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchAndSetStudents();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery, gradeFilter, classFilter, roleFilter, fetchAndSetStudents]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      // Create CSV data
      const headers = ['Name', 'Grade', 'Class', 'Phone', 'Email', 'Role'];
      const csvContent = [
        headers.join(','),
        ...rows.map(student =>
          [
            `"${student.name || ''}"`,
            student.grade || '',
            `"${student.className || ''}"`,
            student.contact?.phone || '',
            student.contact?.email || '',
            student.role || '',
          ].join(',')
        ),
      ].join('\n');

      // Create and download file
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `prefects-roster-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addActionLog(`[${user?.role}] Downloaded prefects roster`);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileSelected = (file: File | null, fileType: string) => {
    if (!file) return;
    setPendingUploadFile({ file, type: fileType });
    setUploadAuthOpen(true);
  };

  const handleUploadConfirm = async (password: string) => {
    if (!pendingUploadFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingUploadFile.file);

      const endpoint = pendingUploadFile.type === 'csv' 
        ? '/api/upload-student-data-csv'
        : `/api/upload-${pendingUploadFile.type}-db`;

      const headers: Record<string, string> = {};
      if (user?.token) {
        headers['Authorization'] = `Bearer ${user.token}`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        headers,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      addActionLog(`[${user?.role}] Uploaded ${pendingUploadFile.file.name}`);
      
      toast({
        title: "Upload Successful",
        description: `${pendingUploadFile.file.name} has been uploaded successfully.`,
      });

      // Reset file inputs
      if (csvInputRef.current) csvInputRef.current.value = '';
      if (dbStudentInputRef.current) dbStudentInputRef.current.value = '';
      if (dbAttendanceInputRef.current) dbAttendanceInputRef.current.value = '';
    } catch (error) {
      console.error('Upload failed:', error);
      toast({
        title: "Upload Failed",
        description: `Failed to upload ${pendingUploadFile.file.name}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setPendingUploadFile(null);
    }
  };

  return (
    <>
      <Card className="glassmorphic glowing-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-headline text-primary">Manage Prefects</CardTitle>
              <CardDescription>View and manage student roles and permissions</CardDescription>
            </div>
            <div className="flex gap-2">
              {canEdit && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setIsAddDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Student
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading || rows.length === 0}
                className="flex items-center gap-2"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download
              </Button>
              {(isAdmin || isDev) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isUploading}
                      className="flex items-center gap-2"
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => csvInputRef.current?.click()}
                    >
                      Upload studentdata.csv
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => dbStudentInputRef.current?.click()}
                    >
                      Upload studentdata.db
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => dbAttendanceInputRef.current?.click()}
                    >
                      Upload attendance.db
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 w-full mb-4">
            <div className="relative flex-grow min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, WhatsApp or email"
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
              <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                <SelectValue placeholder="Filter by grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {availableGrades.map((grade: string) => (
                  <SelectItem key={grade} value={grade}>Grade {grade}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[160px]">
                <SelectValue placeholder="Filter by class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {availableClasses.map((cl: string) => (
                  <SelectItem key={cl} value={cl}>{cl}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="glassmorphic w-full sm:w-[160px]">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="none">No Role</SelectItem>
                {availableRoles.map((r: string) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40 hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Grade & Class</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((student: Student, i: number) => {
                  const sid = getStudentId(student);
                  return (
                    <TableRow
                      key={sid ?? i}
                      onClick={() => handleRowClick(student)}
                      className={canEdit ? "cursor-pointer hover:bg-muted/50" : ""}
                    >
                      <TableCell>{student.name}</TableCell>
                      <TableCell>{student.grade} - {student.className}</TableCell>
                      <TableCell>{student.contact?.phone || 'N/A'}</TableCell>
                      <TableCell>{student.role || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Hidden file inputs */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null, 'csv')}
      />
      <input
        ref={dbStudentInputRef}
        type="file"
        accept=".db"
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null, 'studentdata')}
      />
      <input
        ref={dbAttendanceInputRef}
        type="file"
        accept=".db"
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null, 'attendance')}
      />

      <AddStudentForm open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
      
      <UploadAuthDialog
        role={user?.role || 'moderator'}
        open={uploadAuthOpen}
        onOpenChange={setUploadAuthOpen}
        onSuccess={handleUploadConfirm}
      />
    </>
  );
}

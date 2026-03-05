"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableRow, TableCell, TableHeader, TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useStudentStore } from "@/hooks/use-student-store";
import { useAuthStore } from "@/hooks/use-auth-store";
import { getStudentId } from "@/lib/utils";
import type { Student } from "@/lib/types";
import { Plus, Download, Loader2 } from "lucide-react";
import { AddStudentForm } from "@/components/dashboard/add-student-form";
import { useActionLogStore } from "@/hooks/use-action-log-store";

export function ManagePrefectsTab() {
  const { students } = useStudentStore();
  const { selectStudent } = useStudentStore((state) => state.actions);
  const { user } = useAuthStore();
  const { addActionLog } = useActionLogStore();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const rows = useMemo(() => students || [], [students]);

  const isAdmin = user?.role === 'admin';
  const isDev = user?.role === 'dev';
  const canEdit = isAdmin || isDev;

  const handleRowClick = useCallback((student: Student) => {
    if (canEdit) {
      selectStudent(student);
    }
  }, [canEdit, selectStudent]);

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
            </div>
          </div>
        </CardHeader>
        <CardContent>
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

      <AddStudentForm open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </>
  );
}

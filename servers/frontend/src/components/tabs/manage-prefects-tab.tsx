"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableRow, TableCell, TableHeader, TableHead } from "@/components/ui/table";
import { useStudentStore } from "@/hooks/use-student-store";
import { getStudentId } from "@/lib/utils";
import type { Student } from "@/lib/types";
import { useMemo } from "react";

export function ManagePrefectsTab() {
  const { students } = useStudentStore();

  const rows = useMemo(() => students || [], [students]);

  return (
    <Card>
      <CardContent>
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
                <TableRow key={sid ?? i}>
                  <TableCell>{student.name}</TableCell>
                  <TableCell>{student.grade} - {student.className}</TableCell>
                  <TableCell>{student.contact?.phone || 'N/A'}</TableCell>
                  <TableCell>{student.role || '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

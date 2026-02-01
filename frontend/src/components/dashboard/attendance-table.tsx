
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
import { Search, UserCheck, UserX, Clock, X, Calendar, FilterX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStudentStore } from "@/hooks/use-student-store";
import type { AttendanceStatus } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useMemo } from "react";
import { Button } from "../ui/button";

const statusIcons: Record<AttendanceStatus, React.ReactNode> = {
  "on time": <UserCheck className="h-4 w-4 text-green-500" />,
  absent: <UserX className="h-4 w-4 text-red-500" />,
  late: <Clock className="h-4 w-4 text-yellow-500" />,
  weekend: <Calendar className="h-4 w-4 text-gray-500" />,
};

const statusColors: Record<AttendanceStatus, string> = {
  "on time": 'bg-green-500/10 text-green-400 border-green-500/20',
  absent: 'bg-red-500/10 text-red-400 border-red-500/20',
  late: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  weekend: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function AttendanceTable() {
    const { students, searchQuery, gradeFilter, classFilter, roleFilter, actions, availableGrades, availableClasses, availableRoles } = useStudentStore(state => ({
      students: state.students,
      searchQuery: state.searchQuery,
      gradeFilter: state.gradeFilter,
      classFilter: state.classFilter,
      roleFilter: state.roleFilter,
      actions: state.actions,
      availableGrades: state.availableGrades,
      availableClasses: state.availableClasses,
      availableRoles: state.availableRoles,
    }));
  const { setSearchQuery, selectStudent, setGradeFilter, setClassFilter, setRoleFilter } = actions;
  const clearFilters = () => useStudentStore.getState().actions.resetToDefault?.();

  

  

  
  
  // The students array is now the filtered list from the server
  const filteredStudents = students;

  // Use dynamic availableGrades from the store
  const availableGradesFromStore = availableGrades || [];
  const availableClassesFromStore = availableClasses || [];
  const availableRolesFromStore = availableRoles || [];

  return (
    <>
      <Card className="glassmorphic glowing-border w-full flex flex-col">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Live Attendance</CardTitle>
          <CardDescription>A real-time log of student check-ins</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 w-full mb-4">
            <div className="relative flex-grow">
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
              <SelectTrigger className="glassmorphic w-[140px]">
                <SelectValue placeholder="Filter by grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {availableGradesFromStore.map(grade => (
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
                {availableClassesFromStore.map(c => (
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
                    {availableRolesFromStore.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="ml-auto" onClick={clearFilters} aria-label="Clear filters">
              <FilterX className="h-5 w-5 text-muted-foreground" />
            </Button>
          </div>
          <div className="overflow-y-auto h-[506px] pr-2">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40 hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead className="text-center">Check-in Time</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.map((student) => (
                  <TableRow key={student.id} onClick={() => selectStudent(student)} className="cursor-pointer border-border/40 hover:bg-muted/60 transition-transform duration-150 ease-out hover:scale-[1.01] will-change-transform">
                    <TableCell>
                      <div className="font-medium">{student.name}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      {(student.status as string) === 'weekend' ? (
                        <span className="text-muted-foreground">-</span>
                      ) : student.lastScanTime ? (
                        new Date(student.lastScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`capitalize ${statusColors[student.status]} inline-flex justify-center`}>
                        {statusIcons[student.status]}
                        {student.status === 'weekend' ? 'Weekend Holiday' : student.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
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
            <Button variant="outline" size="icon" className="ml-auto" onClick={clearFilters} aria-label="Clear filters">
              <FilterX className="h-5 w-5 text-muted-foreground" />
            </Button>
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
                      {filteredStudents.map((student, i) => {
                      const sid = getStudentId(student);
                      return (
                        <TableRow key={sid ?? i} onClick={() => selectStudent(student as Student)} className="cursor-pointer border-border/40 hover:bg-muted/60 transition-all duration-300 hover:scale-[1.01]">
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

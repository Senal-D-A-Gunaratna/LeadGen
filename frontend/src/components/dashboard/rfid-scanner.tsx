
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStudentStore } from "@/hooks/use-student-store";
import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import type { AttendanceStatus } from "@/lib/types";

const statusColors: Record<AttendanceStatus, string> = {
  "on time": 'text-green-500',
  absent: 'text-red-500',
  late: 'text-yellow-500',
  weekend: 'text-gray-500',
};


export function RfidScanner() {
  const { recentScans } = useStudentStore();

  return (
    <Card className="glassmorphic glowing-border text-center relative overflow-hidden flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-primary">Live Check-ins</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-4 flex-1">
        <div className="w-full space-y-4 h-64 overflow-y-auto pr-2">
          {recentScans.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">Awaiting Scan</p>
            </div>
          ) : (
            recentScans.map((student, index) => (
              <div 
                  key={`${student.id}-${student.lastScanTime}`} 
                  className={cn(
                    "flex items-center gap-4 p-2 rounded-lg glassmorphic transition-all duration-200",
                    index === 0 && "animate-in fade-in-0 slide-in-from-top-8"
                  )}
                >
                <div className="flex-1 text-left">
                  <p className="font-semibold">{student.name}</p>
                  {student.lastScanTime ? (
                    <p className="text-xs text-muted-foreground">
                      Checked in at {new Date(student.lastScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </p>
                  ) : (
                    <Skeleton className="h-4 w-24 mt-1" />
                  )}
                </div>
                <div className={cn("text-sm font-medium capitalize", statusColors[student.status])}>{student.status}</div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

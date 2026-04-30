
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStudentStore } from "@/hooks/use-student-store";
import { Users, UserCheck, UserX, Clock } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Skeleton } from "../ui/skeleton";
import type { AttendanceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatsCards() {
  const { students, fullRoster, statusFilter, actions } = useStudentStore(state => ({
    students: state.students, // This is the filtered list
    fullRoster: state.fullRoster, // This is the complete list
    statusFilter: state.statusFilter,
    actions: state.actions,
  }));
  const { setStatusFilter } = actions;
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const stats = useMemo(() => {
    if (!isClient || !fullRoster || !students) {
      return { total: 0, onTime: 0, absent: 0, late: 0 };
    }
    // Use the fullRoster for the total count, always
    const total = fullRoster.length;
    
    // Use the full roster for status-specific counts as well, so they don't change on filter
    const onTime = fullRoster.filter((s) => s.status === 'on time').length;
    const absent = fullRoster.filter((s) => s.status === 'absent').length;
    const late = fullRoster.filter((s) => s.status === 'late').length;

    return { total, onTime, absent, late };
  }, [students, fullRoster, isClient]);

  const Stat = ({ value }: { value: number }) => {
    if (!isClient) {
      return <Skeleton className="h-8 w-12" />;
    }
    return <div className="text-2xl font-bold">{value}</div>;
  }

  const handleFilterClick = (status: AttendanceStatus | null) => {
    if (status === statusFilter) {
      setStatusFilter(null);
    } else {
      setStatusFilter(status);
    }
  };

  const getCardClasses = (status: AttendanceStatus) => {
    const isSelected = statusFilter === status;
    return cn(
      "glassmorphic glowing-border cursor-pointer transition-all duration-300 hover:scale-105",
      isSelected && "scale-110 ring-2 ring-primary",
      statusFilter !== null && !isSelected && "opacity-60 hover:opacity-100"
    );
  };
  
  const getTotalCardClasses = () => {
    const isSelected = statusFilter === null;
    return cn(
      "glassmorphic glowing-border cursor-pointer transition-all duration-300 hover:scale-105",
       // Never scale, but show ring if it's the "active" filter clearer
      isSelected && "ring-2 ring-primary",
      statusFilter !== null && !isSelected && "opacity-60 hover:opacity-100"
    )
  }


  return (
    <>
      <Card className={getTotalCardClasses()} onClick={() => setStatusFilter(null)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-primary">Total Students</CardTitle>
          <Users className="h-4 w-4 text-primary" />
        </CardHeader>
        <CardContent>
          <Stat value={stats.total} />
        </CardContent>
      </Card>
      <Card className={getCardClasses("on time")} onClick={() => handleFilterClick("on time")}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-green-500">On Time</CardTitle>
          <UserCheck className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <Stat value={stats.onTime} />
        </CardContent>
      </Card>
      <Card className={getCardClasses("late")} onClick={() => handleFilterClick("late")}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-yellow-500">Late</CardTitle>
          <Clock className="h-4 w-4 text-yellow-500" />
        </CardHeader>
        <CardContent>
          <Stat value={stats.late} />
        </CardContent>
      </Card>
      <Card className={getCardClasses("absent")} onClick={() => handleFilterClick("absent")}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-red-500">Absent</CardTitle>
          <UserX className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <Stat value={stats.absent} />
        </CardContent>
      </Card>
    </>
  );
}


"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Pie, PieChart, Cell } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useStudentStore } from "@/hooks/use-student-store";
import { useMemo, useState, useEffect } from "react";
import { Skeleton } from "../ui/skeleton";

const COLORS = {
  "on time": "#22c55e", // green-500
  late: "hsl(var(--chart-3))",
  absent: "hsl(var(--destructive))",
};

export function AttendanceCharts() {
  const { students, fullRoster } = useStudentStore(state => ({ students: state.students, fullRoster: state.fullRoster }));
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);


  const { overallAttendanceData, gradeWiseData, totalPercentage } = useMemo(() => {
    const onTime = fullRoster.filter((s) => s.status === "on time").length;
    const absent = fullRoster.filter((s) => s.status === "absent").length;
    const late = fullRoster.filter((s) => s.status === "late").length;
    const totalStudents = fullRoster.length;
    
    const overallData = [
      { name: "On Time", value: onTime, fill: COLORS["on time"] },
      { name: "Absent", value: absent, fill: COLORS.absent },
      { name: "Late", value: late, fill: COLORS.late },
    ];
    
    const allGrades = Array.from({ length: 8 }, (_, i) => i + 6); // Creates an array [6, 7, ..., 13]
    
    const gradeData = allGrades
      .map(grade => {
        const gradeStudents = fullRoster.filter(s => s.grade === grade);
        const total = gradeStudents.length;
        
        // Return null if no students are in this grade, so we can filter it out
        if (total === 0) return null; 
        
        const present = gradeStudents.filter(s => s.status === 'on time' || s.status === 'late').length;
        const percentage = Math.round((present / total) * 100);
        
        return {
          name: `${grade}`, // e.g., "6", "7"
          percentage: percentage,
          grade: grade, // Keep original grade for sorting
        };
      })
      // Filter out the null entries for grades with no students
      .filter((item): item is { name: string; percentage: number; grade: number } => item !== null)
      // Sort by grade number to ensure the bar chart is in order
      .sort((a, b) => a.grade - b.grade);

    const presentStudents = onTime + late;
    const percentage = totalStudents > 0 ? Math.round((presentStudents / totalStudents) * 100) : 0;

    return { overallAttendanceData: overallData, gradeWiseData: gradeData, totalPercentage: percentage };
  }, [fullRoster]);


  return (
    <Card className="glassmorphic glowing-border">
      <CardHeader>
        <CardTitle className="font-headline text-primary">Analytics Panel</CardTitle>
        <CardDescription>Attendance trends and breakdowns</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div className="relative h-48">
           <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={overallAttendanceData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                innerRadius={60}
                dataKey="value"
                stroke="none"
                animationDuration={800}
                animationBegin={0}
              >
                {overallAttendanceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
           <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isClient ? (
              <>
                <span className="text-3xl font-bold font-headline">{totalPercentage}%</span>
                <span className="text-sm text-muted-foreground">Present Today</span>
              </>
            ) : (
              <Skeleton className="h-12 w-20" />
            )}
          </div>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gradeWiseData} layout="vertical" margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
              <YAxis
                type="category"
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
                domain={[0, 100]}
              />
              <Bar dataKey="percentage" layout="vertical" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} animationDuration={800} animationBegin={0} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}


"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useUIStateStore } from "@/hooks/use-ui-state-store";
import { Pie, PieChart, Cell, ResponsiveContainer, Sector, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { motion } from "framer-motion";
import { Search, X, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
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
import { useStudentStore } from "@/hooks/use-student-store";
import type { AttendanceStatus, Student } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { CLASSES, PREFECT_ROLES } from "@/lib/student-data";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { MonthYearSelector } from "../ui/month-year-selector";
import { wsClient } from "@/lib/websocket-client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS: Record<AttendanceStatus, string> = {
  "on time": "hsl(var(--chart-2))",
  late: "hsl(var(--chart-3))",
  absent: "hsl(var(--destructive))",
  weekend: "hsl(var(--muted-foreground))",
};

 

const renderCustomizedLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }: any) => {
  // Avoid rendering labels for very small slices (costly and noisy)
  if (!percent || percent < 0.03) return null;

  const RADIAN = Math.PI / 180;
  const sin = Math.sin(-midAngle * RADIAN);
  const cos = Math.cos(-midAngle * RADIAN);
  const sx = cx + (outerRadius + 6) * cos;
  const sy = cy + (outerRadius + 6) * sin;
  const mx = cx + (outerRadius + 18) * cos;
  const my = cy + (outerRadius + 18) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 16;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={payload.fill} fill="none" strokeWidth={1.5} />
      <text x={ex + (cos >= 0 ? 1 : -1) * 10} y={ey} textAnchor={textAnchor} fill="hsl(var(--foreground))" dy={-6} style={{ fontSize: 12 }}>{`${payload.name}`}</text>
      <text x={ex + (cos >= 0 ? 1 : -1) * 10} y={ey} dy={10} textAnchor={textAnchor} fill="hsl(var(--muted-foreground))" style={{ fontSize: 11 }}>
        {`${(Math.round(percent * 100 * 10) / 10).toFixed(1)}%`}
      </text>
    </g>
  );
};

const renderActiveShape = (props: any) => {
  const RADIAN = Math.PI / 180;
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  
  const shift = 10;
  const dx = shift * Math.cos(-midAngle * RADIAN);
  const dy = shift * Math.sin(-midAngle * RADIAN);

  return (
    <g transform={`translate(${dx}, ${dy})`}>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="none"
      />
    </g>
  );
};


// Hook: tween numeric fields between previous and next arrays for smooth transitions
function useTweenedArray<T extends Record<string, any>>(data: T[], keyProp: string, numericKeys: string[], duration = 400) {
  const prevRef = useRef<T[]>(data);
  const [tweened, setTweened] = useState<T[]>(data);

  useEffect(() => {
    const start = prevRef.current || [];
    const end = data || [];

    // fast path
    if (start.length === 0 && end.length === 0) return;

    let rafId = 0;
    let startTime: number | null = null;

    const step = (ts: number) => {
      if (!startTime) startTime = ts;
      const t = Math.min(1, (ts - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic

      // build a map from key to start/end entries
      const startMap = new Map<string, T>();
      start.forEach((it) => startMap.set(String(it[keyProp]), it));
      const endMap = new Map<string, T>();
      end.forEach((it) => endMap.set(String(it[keyProp]), it));

      const out: T[] = end.map((endItem) => {
        const k = String(endItem[keyProp]);
        const s = startMap.get(k) || ({} as T);
        const e = endMap.get(k) || ({} as T);
        const merged: any = { ...endItem };
        numericKeys.forEach((nk) => {
          const sv = Number(s[nk] ?? 0);
          const ev = Number(e[nk] ?? 0);
          merged[nk] = sv + (ev - sv) * ease;
        });
        return merged as T;
      });

      setTweened(out);

      if (t < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        prevRef.current = end;
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => { if (rafId) window.cancelAnimationFrame(rafId); };
  }, [data, keyProp, duration]);

  return tweened;
}


export function AttendanceHistoryTab() {
  const { students, actions, searchQuery, gradeFilter, classFilter, roleFilter, fakeDate, isLoading, availableGrades, availableClasses, availableRoles } = useStudentStore(
    (state: any) => ({
      students: state.students,
      actions: state.actions,
      searchQuery: state.searchQuery,
      gradeFilter: state.gradeFilter,
      classFilter: state.classFilter,
      roleFilter: state.roleFilter,
      fakeDate: state.fakeDate,
      isLoading: state.isLoading,
      availableGrades: state.availableGrades,
      availableClasses: state.availableClasses,
      availableRoles: state.availableRoles,
    })
  );
  const { setSearchQuery, setGradeFilter, setClassFilter, setRoleFilter, selectStudent, setSelectedDate, fetchAndSetStudents } = actions;
  
  const selectedDate = useStudentStore((state: any) => state.selectedDate);

  // Sync with dev tools time freeze initially
  useEffect(() => {
    setSelectedDate(fakeDate ? new Date(fakeDate) : new Date());
  }, [fakeDate, setSelectedDate]);
  
  // Refetch when any filter changes
  useEffect(() => {
    fetchAndSetStudents();
  }, [searchQuery, gradeFilter, classFilter, roleFilter, selectedDate, fetchAndSetStudents]);

  // Global handler clears filters on tab change; no per-tab cleanup here.

  const [activeIndex, setActiveIndex] = useState(-1);
  const studentListRef = useRef<HTMLDivElement>(null);
  const [animateKey, setAnimateKey] = useState(0);
  const [animateNow, setAnimateNow] = useState(false);
  // Trigger short animation when data updates due to filters
  const [animateData, setAnimateData] = useState(false);

  const activeTab = useUIStateStore(state => state.activeTab);
  let visibilityTimer: number | undefined;

  const runTrigger = () => {
    setAnimateKey((k) => k + 1);
    setAnimateNow(true);
    if (visibilityTimer) window.clearTimeout(visibilityTimer);
    visibilityTimer = window.setTimeout(() => setAnimateNow(false), 900);
  };

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") runTrigger();
    };
    document.addEventListener("visibilitychange", handler);
    if (typeof document !== "undefined" && document.visibilityState === "visible") runTrigger();
    return () => {
      document.removeEventListener("visibilitychange", handler);
      if (visibilityTimer) window.clearTimeout(visibilityTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === "attendance-history") runTrigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Animate on data changes (filters) for smooth transitions
  useEffect(() => {
    // don't animate if still loading
    if (isLoading) return;
    // trigger a short animation when attendance or grade data arrays change
    setAnimateData(true);
    const t = window.setTimeout(() => setAnimateData(false), 450);
    return () => window.clearTimeout(t);
  }, [students.length, (availableGrades || []).length, gradeFilter, classFilter, roleFilter, isLoading]);

  // `availableGrades` is provided by the student store (derived from DB)

  const onPieClick = useCallback((data: any, index: number, event?: any) => {
    event?.stopPropagation();
    setActiveIndex(index);
  }, [setActiveIndex]);

  const onContainerClick = (e: React.MouseEvent) => {
    // Only reset if clicking on empty space in the chart area
    const target = e.target as HTMLElement;
    if (target.closest('.recharts-pie-sector') === null && 
        target.closest('.recharts-legend-item') === null &&
        !target.closest('.recharts-tooltip-wrapper')) {
      setActiveIndex(-1);
    }
  };

  const handleBarClick = (data: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const gradeString = data.activePayload[0].payload.grade;
      const grade = gradeString.replace('Grade ', '');
      
      if (grade === gradeFilter) {
        setGradeFilter("all");
      } else {
        setGradeFilter(grade);
      }
      
      studentListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setGradeFilter("all");
    }
  };

  type AttendanceDatum = { name: string; value: number; color: string; percent: number };
  const attendanceData = useMemo<AttendanceDatum[]>(() => {
    const totalStudents = students.length;

    if (totalStudents === 0) return [];

    const onTime = students.filter((s: Student) => s.status === "on time").length;
    const late = students.filter((s: Student) => s.status === "late").length;
    const absent = students.filter((s: Student) => s.status === "absent").length;

    return [
      { name: "On Time", value: onTime, color: COLORS["on time"], percent: totalStudents > 0 ? (onTime / totalStudents) : 0 },
      { name: "Late", value: late, color: COLORS.late, percent: totalStudents > 0 ? (late / totalStudents) : 0 },
      { name: "Absent", value: absent, color: COLORS.absent, percent: totalStudents > 0 ? (absent / totalStudents) : 0 },
    ];
  }, [students]);

  // Tween attendance data for smooth transitions when filters applied
  const tweenedAttendance = useTweenedArray(attendanceData, 'name', ['value', 'percent'], 450);

  const selectedStatus = activeIndex !== -1 ? attendanceData[activeIndex]?.name.toLowerCase() as AttendanceStatus : null;

  type GradeBarDatum = { grade: string; onTime: number; late: number; absent: number; onTimeCount: number; lateCount: number; absentCount: number };
  const gradeWiseStatusData = useMemo<GradeBarDatum[]>(() => {
    const barData = (availableGrades || []).map((gradeStr: string) => {
      const grade = parseInt(gradeStr, 10);
      const gradeStudents = students.filter((s: Student) => s.grade === grade && (!selectedStatus || s.status === selectedStatus));
      const totalInGrade = gradeStudents.length;

      if (totalInGrade === 0) return null;

      const onTimeCount = gradeStudents.filter((s: Student) => s.status === 'on time').length;
      const lateCount = gradeStudents.filter((s: Student) => s.status === 'late').length;
      const absentCount = gradeStudents.filter((s: Student) => s.status === 'absent').length;

      return {
        grade: `Grade ${grade}`,
        onTime: totalInGrade > 0 ? (onTimeCount / totalInGrade) : 0,
        late: totalInGrade > 0 ? (lateCount / totalInGrade) : 0,
        absent: totalInGrade > 0 ? (absentCount / totalInGrade) : 0,
        onTimeCount,
        lateCount,
        absentCount,
      };
    }).filter(Boolean) as GradeBarDatum[];

    return barData;
  }, [students, availableGrades, selectedStatus]);

  // Tween grade-wise data (onTime/late/absent) for smooth transitions
  const tweenedGradeWiseStatusData = useTweenedArray(gradeWiseStatusData, 'grade', ['onTime', 'late', 'absent'], 450);

  // Displayed month for the popover calendar (controls month navigation independent of selectedDate)
  const [displayedMonth, setDisplayedMonth] = useState<Date>(selectedDate ? new Date(selectedDate) : new Date());
  const [monthHasData, setMonthHasData] = useState<boolean | null>(null); // null = unknown/loading
  const [fetchError, setFetchError] = useState<boolean>(false);
  const fetchTimerRef = useRef<number | null>(null);

  // Control popover open state so we can intercept Radix outside events
  const [calendarOpen, setCalendarOpen] = useState<boolean>(false);
  const monthPickerNodeRef = useRef<HTMLElement | null>(null);

  const isMonthWithinRange = (month: Date) => {
    // backend 'month' aggregate covers last ~30 days ending today; consider month has possible data if it overlaps last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 29);
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return monthEnd >= thirtyDaysAgo && monthStart <= today;
  };

  const computeMonthHasDataFromPoints = (points: any[], month: Date) => {
    if (!points || points.length === 0) return false;
    const startIso = new Date(month.getFullYear(), month.getMonth(), 1).toISOString().slice(0,10);
    const endIso = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString().slice(0,10);
    for (const p of points) {
      const label = p.label || p.date || p[0];
      if (!label) continue;
      // labels are often YYYY-MM-DD for month/week ranges
      if (typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
        if (label >= startIso && label <= endIso) {
          // determine if this point contains any attendance (counts or percent)
          const hasCount = (p.on_time || p.late || p.absent) && ((p.on_time||0) + (p.late||0) + (p.absent||0) > 0);
          const hasPercent = typeof p.percent === 'number' ? (p.percent > 0) : false;
          if (hasCount || hasPercent) return true;
        }
      }
    }
    return false;
  };

  const fetchMonthAggregate = async (month: Date, grade: string) => {
    // Debounce rapid month navigation
    if (fetchTimerRef.current) window.clearTimeout(fetchTimerRef.current);
    return new Promise<void>((resolve) => {
      fetchTimerRef.current = window.setTimeout(async () => {
        setMonthHasData(null); // loading
        setFetchError(false);
        try {
          const resp = await wsClient.getAttendanceAggregate('month', grade || 'all', 'overview');
          const points = resp.points || [];
          const has = computeMonthHasDataFromPoints(points, month);
          setMonthHasData(has);
          setFetchError(false);
        } catch (err) {
          console.warn('attendance aggregate fetch failed', err);
          // Do NOT treat socket failure as "no data". Keep calendar usable but mark fetchError.
          setFetchError(true);
          setMonthHasData(true); // let calendar show when socket fails
        }
        resolve();
      }, 250);
    });
  };

  // Run fetch whenever displayedMonth or gradeFilter changes
  useEffect(() => {
    // Only attempt server fetch if the month overlaps the backend's month window; otherwise we can compute that it's likely empty
    if (!isMonthWithinRange(displayedMonth)) {
      setMonthHasData(false);
      setFetchError(false);
      return;
    }
    let mounted = true;
    (async () => {
      await fetchMonthAggregate(displayedMonth, gradeFilter);
      if (!mounted) return;
    })();
    const onDataChanged = () => fetchMonthAggregate(displayedMonth, gradeFilter);
    const onSummaryUpdate = () => fetchMonthAggregate(displayedMonth, gradeFilter);
    try { wsClient.on('data_changed', onDataChanged); wsClient.on('summary_update', onSummaryUpdate); } catch (e) {}
    return () => {
      mounted = false;
      try { wsClient.off('data_changed', onDataChanged); wsClient.off('summary_update', onSummaryUpdate); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedMonth, gradeFilter]);

  const filteredStudentsForTable = useMemo(() => {
    if (!selectedStatus) return students;
    return students.filter((student: Student) => student.status === selectedStatus);
  }, [students, selectedStatus]);

  const percentageFormatter = (value: number) => `${(Math.round(value * 100 * 10) / 10).toFixed(1)}%`;


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glassmorphic glowing-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-headline text-primary">Attendance Breakdown</CardTitle>
            <CardDescription>
                Overview for {selectedDate ? format(selectedDate, "PPP") : "today"}. Click a slice to filter the list.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[350px] w-full" onClick={onContainerClick}>
            <motion.div layout transition={{ duration: 0.35, ease: "easeOut" }} className="h-full">
              <ResponsiveContainer>
                <PieChart margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                  <Pie
                    key={`pie-${animateKey}`}
                    activeIndex={activeIndex}
                    activeShape={renderActiveShape}
                    data={tweenedAttendance}
                    cx="50%"
                    cy="55%"
                    innerRadius={70}
                    outerRadius={100}
                    dataKey="value"
                    onClick={onPieClick}
                    className="cursor-pointer"
                    labelLine={false}
                    label={renderCustomizedLabel}
                    isAnimationActive={true}
                    animationDuration={500}
                    animationBegin={0}
                    animationEasing="ease-out"
                  >
                    {attendanceData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </motion.div>
          </CardContent>
        </Card>
        
        <Card className="glassmorphic glowing-border">
            <CardHeader>
              <CardTitle className="font-headline text-primary">Section wise Presence</CardTitle>
              <CardDescription>Percentage of students on time, late, and absent for each grade on the selected date.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] w-full">
                <motion.div layout transition={{ duration: 0.35, ease: "easeOut" }} className="h-full">
                  <ResponsiveContainer>
                    <BarChart data={tweenedGradeWiseStatusData} layout="vertical" margin={{ top: 20, right: 30, left: 20, bottom: 5 }} onClick={handleBarClick} className="cursor-pointer">
                      <XAxis type="number" domain={[0, 1]} tickFormatter={percentageFormatter} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="grade" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                        }}
                        cursor={{ fill: "hsla(var(--muted), 0.5)" }}
                        formatter={(value: number, name: string, props: any) => {
                          const count = name === 'On Time' ? props.payload.onTimeCount : 
                                       name === 'Late' ? props.payload.lateCount : 
                                       props.payload.absentCount;
                          return `${count}`;
                       }}
                       itemStyle={{ textTransform: 'capitalize' }}
                       labelStyle={{ fontWeight: 'bold' }}
                       separator=": "
                      />
                      <Legend />
                      <Bar dataKey="onTime" name="On Time" stackId="a" fill={COLORS["on time"]} isAnimationActive={true} animationDuration={500} animationBegin={0} animationEasing="ease-out" />
                      <Bar dataKey="late" name="Late" stackId="a" fill={COLORS["late"]} isAnimationActive={true} animationDuration={500} animationBegin={50} animationEasing="ease-out" />
                      <Bar dataKey="absent" name="Absent" stackId="a" fill={COLORS["absent"]} isAnimationActive={true} animationDuration={500} animationBegin={100} animationEasing="ease-out" />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              </div>
            </CardContent>
          </Card>
      </div>

       <Card className="glassmorphic glowing-border" ref={studentListRef}>
            <CardHeader>
                <CardTitle className="font-headline text-primary capitalize">
                     {selectedStatus ? `${selectedStatus} Students` : `All Students`}
                </CardTitle>
                 <CardDescription>
                    A list of students based on the selected filters. Click a student to view details.
                </CardDescription>
            </CardHeader>
            <CardContent>
            <div className="flex flex-wrap gap-2 w-full mb-4">
                <div className="relative flex-grow min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                    placeholder="Search by name or phone"
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
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                    <Button
                        variant={"outline"}
                        className={cn(
                        "w-full sm:w-[240px] justify-start text-left font-normal glassmorphic",
                        !selectedDate && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto p-0"
                      onPointerDownOutside={(e: any) => {
                        // If the pointerdown that would dismiss the popover started
                        // inside the month-picker node, prevent Radix from closing.
                        const target = e?.target as Node | null;
                        if (monthPickerNodeRef.current && target && monthPickerNodeRef.current.contains(target)) {
                          e.preventDefault();
                          return;
                        }
                        // Otherwise, close the popover
                        setCalendarOpen(false);
                      }}
                    >
                    <div className="p-2">
                      <MonthYearSelector
                        displayedMonth={displayedMonth}
                        onMonthChange={setDisplayedMonth}
                        showYearSelector={true}
                        onMonthPickerMount={(n) => (monthPickerNodeRef.current = n)}
                      />

                      {/* Loading or socket error: show skeleton only on fetchError; show placeholder while loading */}
                      {fetchError ? (
                        <div className="relative">
                          <Calendar
                            mode="single"
                            month={displayedMonth}
                            onMonthChange={(m) => setDisplayedMonth(m)}
                            selected={selectedDate}
                            onSelect={(date) => setSelectedDate(date)}
                            classNames={{ nav: 'hidden', caption: 'hidden', head_cell: 'invisible', day: 'invisible' }}
                            disabled={(date) => {
                              const isOutOfRange = date > new Date() || date < new Date("2000-01-01");
                              const day = date.getDay();
                              const isWeekend = day === 0 || day === 6;
                              return isOutOfRange || isWeekend;
                            }}
                            initialFocus
                            weekStartsOn={1}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <div className="w-[260px]">
                              <Skeleton className="h-40 w-full" />
                            </div>
                            <div className="mt-2 pointer-events-auto">
                              <button className="px-3 py-1 rounded bg-muted text-muted-foreground" onClick={() => fetchMonthAggregate(displayedMonth, gradeFilter)}>Retry</button>
                            </div>
                          </div>
                        </div>
                      ) : monthHasData === null ? (
                        // Still loading: show the placeholder (no flashing calendar)
                        <div className="relative">
                          <div className="min-w-[280px] min-h-[280px] p-3 rounded-md border border-border/40 bg-background"></div>
                        </div>
                      ) : monthHasData === false ? (
                        // No data for this month: render a calendar-sized placeholder and overlay a message
                        <div className="relative">
                          <div className="min-w-[280px] min-h-[280px] p-3 rounded-md border border-border/40 bg-background"></div>
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                            <div className="text-lg font-semibold mb-2">No Data Available</div>
                            <div className="text-sm">There is no attendance data for this month.</div>
                          </div>
                        </div>
                      ) : (
                        // monthHasData === true
                        <Calendar
                          mode="single"
                          month={displayedMonth}
                          onMonthChange={(m) => setDisplayedMonth(m)}
                          selected={selectedDate}
                          onSelect={(date) => setSelectedDate(date)}
                          classNames={{ nav: 'hidden', caption: 'hidden' }}
                          disabled={(date) => {
                            const isOutOfRange = date > new Date() || date < new Date("2000-01-01");
                            const day = date.getDay();
                            const isWeekend = day === 0 || day === 6;
                            return isOutOfRange || isWeekend;
                          }}
                          initialFocus
                          weekStartsOn={1}
                        />
                      )}
                    </div>
                    </PopoverContent>
                </Popover>
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
                <SelectTrigger className="glassmorphic w-full sm:w-[140px]">
                    <SelectValue placeholder="Filter by class" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                  {(availableClasses || []).map((c: string) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
                </Select>
                 <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="glassmorphic w-full sm:w-[180px]">
                        <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="none">No Role</SelectItem>
                        {(availableRoles || []).map((role: string) => (
                          <SelectItem key={role} value={role}>{role}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
             <p className="text-sm text-muted-foreground mb-4">
                Showing {filteredStudentsForTable.length} student(s)
            </p>
            <div className="h-[300px] overflow-y-auto rounded-md border border-border/40">
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <Table>
                      <TableHeader>
                          <TableRow className="hover:bg-transparent">
                              <TableHead>Name</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead>Class</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {filteredStudentsForTable.length > 0 ? (
                              filteredStudentsForTable.map((student: Student) => (
                                  <TableRow key={student.id} onClick={() => selectStudent(student)} className="cursor-pointer border-border/40 hover:bg-muted/60 transition-all">
                                      <TableCell className="font-medium">{student.name}</TableCell>
                                      <TableCell>{student.grade}</TableCell>
                                      <TableCell>{student.className}</TableCell>
                                  </TableRow>
                              ))
                          ) : (
                              <TableRow>
                                  <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
                                      No students match the current filters.
                                  </TableCell>
                              </TableRow>
                          )}
                      </TableBody>
                  </Table>
                )}
            </div>
        </CardContent>
       </Card>
    </div>
  );
}

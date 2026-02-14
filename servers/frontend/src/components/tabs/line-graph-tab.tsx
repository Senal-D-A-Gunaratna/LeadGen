"use client";

import { useMemo, useState, useEffect } from "react";
import { useStudentStore } from "@/hooks/use-student-store";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { FilterX } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { wsClient } from "@/lib/websocket-client";

export function LineGraphTab() {
  const { students } = useStudentStore((s: any) => ({ students: s.students }));

  // Leave empty to request full history by default
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const availableGrades = useStudentStore(state => state.availableGrades || []);
  const GRADE_OPTIONS = ["all", ...availableGrades];
  const [grade, setGrade] = useState<string>("all");
  const [data, setData] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);

  const [range, setRange] = useState<'day'|'week'|'month'|'year'>('week');
  const STATUSES = [
    { value: 'overview', label: 'Overview' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'ontime', label: 'On-time' },
    { value: 'late', label: 'Late' },
    { value: 'absent', label: 'Absent' }
  ];
  const [status, setStatus] = useState<string>('overview');

  // WebSocket connection is handled centrally in `servers/frontend/src/app/page.tsx`
  useEffect(() => {
    // noop: connection performed at app root
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const resp = await wsClient.getAttendanceAggregate(range, grade, status);
        if (!mounted) return;
        const points = resp.points || [];
        // Helper to format labels based on selected range
        const formatLabel = (lab: string) => {
          try {
            if (range === 'day') {
              // Expect labels like 'HH:00' or 'HH'
              if (/^\d{1,2}:?\d{0,2}$/.test(lab)) return lab;
              // If ISO with time, format hour:minute
              const d = new Date(lab);
              if (!isNaN(d.getTime())) return format(d, 'HH:mm');
              return lab;
            }
            if (range === 'year') {
              // labels like 'YYYY-MM'
              if (/^\d{4}-\d{2}$/.test(lab)) {
                const d = new Date(lab + '-01');
                return format(d, 'MMM yyyy');
              }
              if (/^\d{4}-\d{2}-\d{2}$/.test(lab)) {
                return format(new Date(lab), 'MMM yyyy');
              }
              return lab;
            }
            // Default (week/month): ISO date -> 'MMM d'
            if (/^\d{4}-\d{2}-\d{2}$/.test(lab)) {
              return format(new Date(lab), 'MMM d');
            }
            return lab;
          } catch (e) {
            return lab;
          }
        };

        // Map labels and detect multi-series (on_time/late/absent)
        if (points.length > 0 && (points[0].on_time !== undefined || points[0].late !== undefined || points[0].absent !== undefined)) {
          setData(points.map((p: any) => ({
            date: formatLabel(p.label),
            on_time: Number(p.on_time ?? 0),
            late: Number(p.late ?? 0),
            absent: Number(p.absent ?? 0)
          })));
        } else {
          // Single-series with safe fallback to avoid NaN values
          const mapped = points.map((p: any) => ({ date: formatLabel(p.label), percent: Number(p.percent ?? 0) }));
          // Debugging: log if all values are zero or NaN which may indicate upstream problems
          const anyNonZero = mapped.some((m: any) => Number.isFinite(m.percent) && m.percent !== 0);
          if (!anyNonZero) {
            console.debug('LineGraphTab: received single-series points but all percent values are zero/empty', { range, grade, status, sample: mapped.slice(0,3) });
          }
          setData(mapped);
        }
      } catch (e) {
        setData([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchData();
    return () => { mounted = false; };
  }, [range, grade, status]);

  const clearFilters = () => {
    useStudentStore.getState().actions.clearFilters();
    setRange('week');
    setGrade('all');
    setStatus('overview');
    setStartDate('');
    setEndDate('');
  };

  // Global tab change will handle clearing filters; no per-tab cleanup here.

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <div className="flex gap-2 items-center">
          <label className="text-sm text-muted-foreground">Range</label>
          <Select value={range} onValueChange={(v) => setRange(v as any)}>
            <SelectTrigger className="glassmorphic w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-muted-foreground">Grade</label>
          <Select value={grade} onValueChange={(v) => setGrade(v)}>
            <SelectTrigger className="glassmorphic w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRADE_OPTIONS.map((g) => (
                <SelectItem key={g} value={g}>{g === 'all' ? 'All Grades' : `Grade ${g}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-muted-foreground">Filter</label>
          <Select value={status} onValueChange={(v) => setStatus(v)}>
            <SelectTrigger className="glassmorphic w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-muted-foreground">Custom Range</label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="glassmorphic" />
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="glassmorphic" />
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="icon" onClick={clearFilters} aria-label="Clear filters">
            <FilterX className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <Card className="glassmorphic glowing-border">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Attendance</CardTitle>
          <CardDescription>Line graph of on-time attendance percentage for the selected range and grade.</CardDescription>
        </CardHeader>
        <CardContent className="h-[420px]">
          {loading ? (
            <div className="flex items-center justify-center h-full">Loading...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Legend />
                {/* Multi-series overview: on_time (green), late (orange), absent (red) */}
                {data && data.length > 0 && (data[0] as any).on_time !== undefined ? (
                  <>
                    <Line type="monotone" dataKey="on_time" stroke="#22c55e" strokeWidth={3} dot={{ r: 3 }} name="On-time" />
                    <Line type="monotone" dataKey="late" stroke="#f97316" strokeWidth={3} dot={{ r: 3 }} name="Late" />
                    <Line type="monotone" dataKey="absent" stroke="#ef4444" strokeWidth={3} dot={{ r: 3 }} name="Absent" />
                  </>
                ) : (
                  <Line type="monotone" dataKey="percent" stroke="hsl(var(--chart-2))" strokeWidth={3} dot={{ r: 4 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

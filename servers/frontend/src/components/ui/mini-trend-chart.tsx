import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';

interface Point { date: string; on_time?: number; late?: number; absent?: number; arrival_minutes?: number | null; arrival_local?: string | null }

function minutesToHHMM(mins: number) {
  const hh = Math.floor(mins / 60).toString().padStart(2, '0');
  const mm = (mins % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function MiniTrendChart({ points, statusColors }: { points: Point[]; statusColors: Record<string,string> }) {
  // Sort by date - only school days with attendance records are included
  const sorted = [...(points || [])].sort((a,b) => a.date.localeCompare(b.date));
  const dayLabels = sorted.map(p => {
    const d = new Date(p.date + 'T00:00:00');
    return { ...p, day: d.getDate() };
  });

  console.log('MiniTrendChart received points:', sorted.length, 'points', sorted);
  console.log('MiniTrendChart dayLabels:', dayLabels.length, dayLabels);

  const numericValues = dayLabels.map(p => (typeof p.arrival_minutes === 'number' ? p.arrival_minutes : NaN)).filter(v => !isNaN(v));
  const minVal = numericValues.length ? Math.min(...numericValues) : 480; // default 08:00
  const maxVal = numericValues.length ? Math.max(...numericValues) : 540; // default 09:00

  // If there are records without arrival minutes (e.g. absent), assign
  // them a sentinel plotting value slightly earlier than the earliest
  // arrival so they are visible on the chart as markers.
  const absentMarker = Math.max(0, minVal - 45);

  const plotted = dayLabels.map(p => {
    const hasArrival = typeof p.arrival_minutes === 'number' && !isNaN(p.arrival_minutes as any);
    const isAbsent = !!p.absent;
    return {
      ...p,
      plot_minutes: hasArrival ? p.arrival_minutes : (isAbsent ? absentMarker : NaN),
    };
  });

  return (
    <div className="w-full h-full" style={{ color: 'var(--muted-foreground-high)', paddingLeft: 0, marginLeft: 0, overflow: 'visible' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={plotted} margin={{ top: 5, right: 5, left: -15, bottom: -5 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.08} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'currentColor', fontSize: 12 }}
          />
          <YAxis
            domain={[Math.max(0, minVal - 60), maxVal + 15]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            tickFormatter={(v) => (isNaN(Number(v)) ? '' : minutesToHHMM(Number(v)))}
          />
          <Tooltip
            contentStyle={{ background: 'var(--popover)', borderRadius: 6, border: '1px solid var(--border)' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length > 0) {
                const data = payload[0].payload as Point & { day: number };
                let status = 'Unknown';
                let statusColor = '#666';
                
                if (data.on_time) {
                  status = 'On Time';
                  statusColor = statusColors['on time'] || '#22c55e';
                } else if (data.late) {
                  status = 'Late';
                  statusColor = statusColors['late'] || '#eab308';
                } else if (data.absent) {
                  status = 'Absent';
                  statusColor = statusColors['absent'] || '#ef4444';
                }
                
                const arrivalTime = typeof data.arrival_minutes === 'number' ? minutesToHHMM(data.arrival_minutes) : null;

                return (
                  <div className="p-2 space-y-1 text-sm">
                    <div className="font-medium">Day {data.day}</div>
                    <div style={{ color: statusColor }}>Status: <span className="font-semibold">{status}</span></div>
                    {(!data.absent && arrivalTime) ? (
                      <div style={{ color: statusColor }}>Arrival: {arrivalTime}</div>
                    ) : null}
                  </div>
                );
              }
              return null;
            }}
          />
          <Line type="monotone" dataKey="plot_minutes" stroke={statusColors['on time'] || '#22c55e'} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={true} />

        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

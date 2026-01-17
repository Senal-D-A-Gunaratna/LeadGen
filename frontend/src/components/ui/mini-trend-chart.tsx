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

  const numericValues = dayLabels.map(p => (typeof p.arrival_minutes === 'number' ? p.arrival_minutes : NaN)).filter(v => !isNaN(v));
  const minVal = numericValues.length ? Math.min(...numericValues) : 480; // default 08:00
  const maxVal = numericValues.length ? Math.max(...numericValues) : 540; // default 09:00

  return (
    <div className="w-full h-full" style={{ color: 'var(--muted-foreground-high)', paddingLeft: 0, marginLeft: 0, overflow: 'visible' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dayLabels} margin={{ top: 5, right: 5, left: -15, bottom: -5 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.08} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'currentColor', fontSize: 12 }}
          />
          <YAxis
            domain={[Math.max(0, minVal - 15), maxVal + 15]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            tickFormatter={(v) => (isNaN(Number(v)) ? '' : minutesToHHMM(Number(v)))}
          />
          <Tooltip
            contentStyle={{ background: 'var(--popover)', borderRadius: 6, border: '1px solid var(--border)' }}
            formatter={(value: any, name: string) => {
              const displayName = name === 'arrival_minutes' ? 'Arrival Time' : name;
              const displayValue = typeof value === 'number' ? minutesToHHMM(value) : value;
              return [displayValue, displayName];
            }}
            labelFormatter={(label) => `Day ${label}`}
            separator=" "
          />
          <Line type="monotone" dataKey="arrival_minutes" stroke={statusColors['on time'] || '#22c55e'} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={true} />

        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

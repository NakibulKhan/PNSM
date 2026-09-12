import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '@/types/api';

/**
 * Client-only chart body. The final bar is the current, still-incomplete day,
 * so it is drawn in the accent colour to stop anyone reading a partial day as a
 * drop in attendance.
 */
export function TrendBars({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line)' }}
            tick={{ fontSize: 11, fill: 'var(--color-faint)' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--color-faint)' }}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-accent-soft)' }}
            contentStyle={{
              borderRadius: 6,
              border: '1px solid var(--color-line)',
              fontSize: 12,
              boxShadow: '0 6px 20px rgba(15,27,45,0.12)',
            }}
            labelStyle={{ fontWeight: 600, color: 'var(--color-ink)' }}
            formatter={(value: number) => [`${value} employees`, 'Checked in']}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={46}>
            {data.map((point, index) => (
              <Cell
                key={point.date}
                fill={index === data.length - 1 ? 'var(--color-accent)' : 'var(--color-line-strong)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

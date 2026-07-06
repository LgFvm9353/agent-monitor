/**
 * BarChart — 柱状图组件
 *
 * 用于对比分布数据，支持横向/纵向
 */
import { BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CHART_COLORS, LIGHT_CHART_THEME } from './chart-theme';

interface BarChartData {
  name: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartData[];
  height?: number;
  layout?: 'vertical' | 'horizontal';
  showGrid?: boolean;
  barSize?: number;
}

export function BarChart({
  data,
  height = 240,
  layout = 'horizontal',
  showGrid = true,
  barSize,
}: BarChartProps) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={data} layout={layout} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={LIGHT_CHART_THEME.grid}
              horizontal={layout === 'vertical'}
              vertical={layout === 'horizontal'}
            />
          )}
          {layout === 'vertical' ? (
            <>
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
                axisLine={false}
                tickLine={false}
                domain={[0, maxVal * 1.15]}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
                axisLine={false}
                tickLine={false}
                width={100}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
                axisLine={false}
                tickLine={false}
                domain={[0, maxVal * 1.15]}
              />
            </>
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: LIGHT_CHART_THEME.tooltipBg,
              border: `1px solid ${LIGHT_CHART_THEME.tooltipBorder}`,
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(value: number) => [value.toLocaleString()]}
            labelStyle={{ color: LIGHT_CHART_THEME.text }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={barSize}>
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.color || CHART_COLORS.palette[index % CHART_COLORS.palette.length]}
              />
            ))}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * TrendChart — 趋势折线图组件
 *
 * 用于展示时间序列数据，支持多条线对比
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS, LIGHT_CHART_THEME } from './chart-theme';

interface TrendSeries {
  key: string;
  name: string;
  color?: string;
}

interface TrendChartProps {
  data: Record<string, unknown>[];
  series: TrendSeries[];
  height?: number;
  xKey?: string;
  showGrid?: boolean;
}

export function TrendChart({
  data,
  series,
  height = 240,
  xKey = 'name',
  showGrid = true,
}: TrendChartProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_CHART_THEME.grid} />
          )}
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: LIGHT_CHART_THEME.text }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: LIGHT_CHART_THEME.tooltipBg,
              border: `1px solid ${LIGHT_CHART_THEME.tooltipBorder}`,
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: LIGHT_CHART_THEME.text }}
          />
          <Legend
            verticalAlign="top"
            height={28}
            iconType="line"
            iconSize={14}
            formatter={(value: string) => (
              <span style={{ color: LIGHT_CHART_THEME.text, fontSize: '12px' }}>{value}</span>
            )}
          />
          {series.map((s, index) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color || CHART_COLORS.palette[index % CHART_COLORS.palette.length]}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

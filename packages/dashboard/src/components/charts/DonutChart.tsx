/**
 * DonutChart — 环形图组件
 *
 * 用于展示占比分布，带中心文字
 */
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHART_COLORS, LIGHT_CHART_THEME } from './chart-theme';

interface DonutChartData {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutChartData[];
  centerLabel?: string;
  centerValue?: string;
  height?: number;
  showLegend?: boolean;
  innerRadius?: number;
  outerRadius?: number;
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
  height = 240,
  showLegend = true,
  innerRadius = 60,
  outerRadius = 90,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            dataKey="value"
            stroke="transparent"
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.color || CHART_COLORS.palette[index % CHART_COLORS.palette.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: LIGHT_CHART_THEME.tooltipBg,
              border: `1px solid ${LIGHT_CHART_THEME.tooltipBorder}`,
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(value: number) => [
              `${value.toLocaleString()} (${((value / total) * 100).toFixed(1)}%)`,
            ]}
            labelStyle={{ color: LIGHT_CHART_THEME.text }}
          />
          {showLegend && (
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => (
                <span style={{ color: LIGHT_CHART_THEME.text, fontSize: '12px' }}>{value}</span>
              )}
            />
          )}
        </PieChart>
      </ResponsiveContainer>

      {/* Center text */}
      {centerValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-foreground">{centerValue}</span>
          {centerLabel && <span className="text-xs text-foreground">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

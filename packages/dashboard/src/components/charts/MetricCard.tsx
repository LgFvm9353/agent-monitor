/**
 * MetricCard — 指标卡片组件
 *
 * 展示单个核心指标，含图标、标签、数值和可选变化趋势
 */
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface MetricCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color?: string;
  trend?: {
    value: string;
    positive: boolean;
  };
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, color = 'text-primary', trend, className }: MetricCardProps) {
  return (
    <div className={cn('bg-white border border-border rounded-lg p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={cn('w-4 h-4', color)} />
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {trend && (
          <span className={cn('text-xs font-medium', trend.positive ? 'text-emerald-600' : 'text-red-500')}>
            {trend.positive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}

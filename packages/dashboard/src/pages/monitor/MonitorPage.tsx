/**
 * Monitor Page — Dashboard 自身监控（Dogfooding）
 *
 * 使用 @agent-harness/monitor-sdk 监控 Dashboard 自身的：
 * - Core Web Vitals
 * - JS Errors
 * - API 请求性能
 */

import { useState, useEffect } from 'react';
import { Activity, AlertTriangle, Clock, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { MetricCard } from '../../components/charts/MetricCard';
import { DonutChart } from '../../components/charts/DonutChart';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { CHART_COLORS } from '../../components/charts/chart-theme';

interface MonitorEvent {
  id: string;
  type: string;
  data: string;
  url: string;
  sessionId: string;
  userAgent: string;
  timestamp: number;
}

interface MonitorStats {
  total: number;
  byType: Record<string, number>;
}

const TYPE_COLORS: Record<string, string> = {
  error: CHART_COLORS.destructive,
  performance: CHART_COLORS.warning,
  behavior: CHART_COLORS.success,
  custom: CHART_COLORS.purple,
};

const TYPE_LABELS: Record<string, string> = {
  error: '错误',
  performance: '性能',
  behavior: '行为',
  custom: '自定义',
};

export function MonitorPage() {
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getMonitorStats().then((data) => setStats(data as MonitorStats)),
      api.getMonitorEvents().then((data) => setEvents((data as MonitorEvent[]).slice(0, 10))),
    ]).catch((err) => setError(err.message));
  }, []);

  const statsValue = stats || { total: 0, byType: {} };

  const metricCards = [
    { label: 'Total Events', value: statsValue.total.toLocaleString(), icon: Activity, color: 'text-blue-600' },
    { label: 'Errors', value: (statsValue.byType?.error || 0).toLocaleString(), icon: AlertTriangle, color: 'text-red-600' },
    { label: 'Performance', value: (statsValue.byType?.performance || 0).toLocaleString(), icon: Zap, color: 'text-yellow-600' },
    { label: 'Behavior', value: (statsValue.byType?.behavior || 0).toLocaleString(), icon: Clock, color: 'text-emerald-600' },
  ];

  // 事件类型分布环形图数据
  const typeChartData = Object.entries(statsValue.byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({
      name: TYPE_LABELS[type] || type,
      value: count,
      color: TYPE_COLORS[type] || CHART_COLORS.palette[0],
    }));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2 text-foreground">Frontend Monitor</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Dashboard self-monitoring via @agent-harness/monitor-sdk (Dogfooding)
      </p>

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      {/* Charts + Events */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {/* Event Type Distribution */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">事件类型分布</h3>
            {typeChartData.length > 0 ? (
              <DonutChart
                data={typeChartData}
                centerLabel="Total"
                centerValue={statsValue.total.toLocaleString()}
                height={240}
              />
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                No events yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">最近事件</h3>
            {events.length > 0 ? (
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {events.map((event) => {
                  let parsedData: Record<string, unknown> = {};
                  try {
                    parsedData = JSON.parse(event.data);
                  } catch { /* keep raw */ }
                  return (
                    <div
                      key={event.id}
                      className="flex items-center gap-2 text-sm p-2 rounded bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <Badge variant={
                        event.type === 'error' ? 'destructive' :
                        event.type === 'performance' ? 'warning' :
                        event.type === 'behavior' ? 'success' : 'muted'
                      }>
                        {TYPE_LABELS[event.type] || event.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate flex-1">
                        {typeof parsedData === 'object' && 'message' in parsedData
                          ? String(parsedData.message).slice(0, 80)
                          : event.type === 'performance' && 'name' in parsedData
                            ? String(parsedData.name)
                            : event.id.slice(0, 12) + '...'}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                No events recorded
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Self-Monitoring Info */}
      <Card>
        <CardContent>
          <h3 className="text-sm font-medium mb-2 text-foreground">Self-Monitoring Active</h3>
          <p className="text-sm text-muted-foreground">
            This dashboard is instrumented with <code className="text-primary">@agent-harness/monitor-sdk</code>.
            Core Web Vitals, JavaScript errors, and API request performance are being tracked
            and reported back to the same backend, demonstrating the complete monitoring loop.
          </p>
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div>✓ Core Web Vitals (LCP, FCP, CLS, INP, TTFB)</div>
            <div>✓ JavaScript Error Tracking</div>
            <div>✓ Promise Rejection Capture</div>
            <div>✓ API Request Monitoring</div>
            <div>✓ Route Change Tracking</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

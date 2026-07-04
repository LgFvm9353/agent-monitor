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

interface MonitorStats {
  total: number;
  byType: Record<string, number>;
}

export function MonitorPage() {
  const [stats, setStats] = useState<MonitorStats | null>(null);

  useEffect(() => {
    api.getMonitorStats().then((data) => setStats(data as MonitorStats)).catch(console.error);
  }, []);

  const cards = [
    { label: 'Total Events', value: stats?.total || 0, icon: Activity, color: 'text-blue-400' },
    { label: 'Errors', value: stats?.byType?.error || 0, icon: AlertTriangle, color: 'text-red-400' },
    { label: 'Performance', value: stats?.byType?.performance || 0, icon: Zap, color: 'text-yellow-400' },
    { label: 'Behavior', value: stats?.byType?.behavior || 0, icon: Clock, color: 'text-green-400' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Frontend Monitor</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Dashboard self-monitoring via @agent-harness/monitor-sdk (Dogfooding)
      </p>

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className="text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      {/* Self-Monitoring Info */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Self-Monitoring Active</h3>
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
      </div>
    </div>
  );
}

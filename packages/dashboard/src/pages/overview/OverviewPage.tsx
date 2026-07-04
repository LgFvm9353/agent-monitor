/**
 * Overview Dashboard — 全局概览页
 *
 * 展示 Agent 监控的核心指标：
 * - 请求总数、成功率、平均延迟、Token 花费
 * - 24h 趋势图、模型分布、Top 错误
 */

import { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle2, Clock, DollarSign } from 'lucide-react';
import { api } from '../../lib/api';

interface Stats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  modelDistribution: Record<string, number>;
}

export function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.getTraceStats().then((data) => setStats(data as Stats)).catch(console.error);
  }, []);

  if (!stats) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const cards = [
    { label: '总请求数', value: stats.total.toLocaleString(), icon: TrendingUp, color: 'text-blue-400' },
    { label: '成功率', value: `${(stats.successRate * 100).toFixed(1)}%`, icon: CheckCircle2, color: 'text-green-400' },
    { label: '平均延迟', value: `${stats.avgDurationMs}ms`, icon: Clock, color: 'text-yellow-400' },
    { label: 'Token 花费', value: `$${stats.totalEstimatedCost.toFixed(2)}`, icon: DollarSign, color: 'text-purple-400' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Overview Dashboard</h2>

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

      {/* Token Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm text-muted-foreground mb-2">Token 消耗</h3>
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Input</div>
              <div className="text-lg font-mono font-bold">{stats.totalInputTokens.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Output</div>
              <div className="text-lg font-mono font-bold">{stats.totalOutputTokens.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm text-muted-foreground mb-2">模型分布</h3>
          <div className="space-y-1">
            {Object.entries(stats.modelDistribution).map(([model, count]) => (
              <div key={model} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{model}</span>
                <span className="text-muted-foreground">{count} requests</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Success / Fail */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm text-muted-foreground mb-3">执行状态</h3>
        <div className="flex h-4 rounded-full overflow-hidden">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${stats.successRate * 100}%` }}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${(1 - stats.successRate) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span className="text-green-400">{stats.successful} Success</span>
          <span className="text-red-400">{stats.failed} Failed</span>
        </div>
      </div>
    </div>
  );
}

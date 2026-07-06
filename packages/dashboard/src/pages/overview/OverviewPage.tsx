/**
 * Overview Dashboard — 全局概览页
 *
 * 展示 Agent 监控的核心指标：
 * - 请求总数、成功率、平均延迟、Token 花费
 * - Token 消耗环形图、模型分布柱状图、执行状态
 */

import { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle2, Clock, DollarSign } from 'lucide-react';
import { api } from '../../lib/api';
import { MetricCard } from '../../components/charts/MetricCard';
import { DonutChart } from '../../components/charts/DonutChart';
import { BarChart } from '../../components/charts/BarChart';
import { Card, CardContent } from '../../components/ui/Card';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTraceStats()
      .then((data) => setStats(data as Stats))
      .catch((err) => setError(err.message));
  }, []);

  // 加载中
  if (!stats && !error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading stats...
        </div>
      </div>
    );
  }

  // 错误状态
  if (error && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-2">Failed to load stats</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const metricCards = [
    { label: '总请求数', value: stats.total.toLocaleString(), icon: TrendingUp, color: 'text-blue-600' },
    { label: '成功率', value: `${(stats.successRate * 100).toFixed(1)}%`, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: '平均延迟', value: `${stats.avgDurationMs}ms`, icon: Clock, color: 'text-yellow-600' },
    { label: 'Token 花费', value: `$${stats.totalEstimatedCost.toFixed(2)}`, icon: DollarSign, color: 'text-purple-600' },
  ];

  // Token 环形图数据
  const tokenData = [
    { name: 'Input', value: stats.totalInputTokens, color: 'hsl(217.2, 91.2%, 59.8%)' },
    { name: 'Output', value: stats.totalOutputTokens, color: 'hsl(271, 81%, 56%)' },
  ];

  // 模型分布柱状图数据
  const modelData = Object.entries(stats.modelDistribution).map(([model, count]) => ({
    name: model,
    value: count,
  }));

  // 执行状态环形图
  const statusData = [
    { name: 'Success', value: stats.successful, color: 'hsl(142, 71%, 45%)' },
    { name: 'Failed', value: stats.failed, color: 'hsl(0, 84%, 60%)' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6 text-foreground">Overview Dashboard</h2>

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Token Distribution */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">Token 消耗分布</h3>
            <DonutChart
              data={tokenData}
              centerLabel="Total"
              centerValue={((stats.totalInputTokens + stats.totalOutputTokens) / 1000).toFixed(0) + 'K'}
              showLegend
              height={220}
            />
          </CardContent>
        </Card>

        {/* Execution Status */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">执行状态</h3>
            <DonutChart
              data={statusData}
              centerLabel="Success Rate"
              centerValue={`${(stats.successRate * 100).toFixed(1)}%`}
              showLegend
              height={220}
            />
          </CardContent>
        </Card>

        {/* Model Distribution */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">模型分布</h3>
            {modelData.length > 0 ? (
              <BarChart data={modelData} layout="vertical" height={220} showGrid={false} barSize={20} />
            ) : (
              <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">Token 详情</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Input Tokens</span>
                <span className="font-mono font-bold text-foreground">{stats.totalInputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Output Tokens</span>
                <span className="font-mono font-bold text-foreground">{stats.totalOutputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">Estimated Cost</span>
                <span className="font-mono font-bold text-primary">${stats.totalEstimatedCost.toFixed(4)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-sm font-medium text-foreground mb-2">延迟统计</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">平均延迟</span>
                <span className="font-mono font-bold text-foreground">{stats.avgDurationMs}ms</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">总请求</span>
                <span className="font-mono font-bold text-foreground">{stats.total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">失败数</span>
                <span className={stats.failed > 0 ? 'font-mono font-bold text-red-600' : 'font-mono font-bold text-foreground'}>
                  {stats.failed.toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Eval Dashboard — 评估中心
 *
 * 用于管理评估数据集和查看评估结果。
 * 评估 = Agent 的"单元测试"，量化 Prompt 迭代效果。
 */

import { useState, useEffect } from 'react';
import { Plus, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';

interface Dataset {
  id: string;
  name: string;
  description: string;
  items: string; // JSON string
  createdAt: number;
}

interface EvalRun {
  id: string;
  datasetId: string;
  passRate: number;
  startTime: number;
  endTime: number;
}

export function EvalDashboardPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);

  useEffect(() => {
    api.getDatasets().then((data) => setDatasets(data as Dataset[])).catch(console.error);
    api.getEvalRuns().then((data) => setRuns(data as EvalRun[])).catch(console.error);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Eval &amp; Regression</h2>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Dataset
        </button>
      </div>

      {/* Datasets */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {datasets.map((ds) => {
          const items = JSON.parse(ds.items || '[]');
          return (
            <div key={ds.id} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors cursor-pointer">
              <h3 className="font-semibold mb-1">{ds.name}</h3>
              {ds.description && (
                <p className="text-sm text-muted-foreground mb-3">{ds.description}</p>
              )}
              <div className="text-xs text-muted-foreground">
                {items.length} test cases · Created {new Date(ds.createdAt).toLocaleDateString()}
              </div>
            </div>
          );
        })}
        {datasets.length === 0 && (
          <div className="col-span-2 text-center text-muted-foreground py-12 bg-card border border-border rounded-lg">
            <p>No datasets yet. Create one to start evaluating your agents.</p>
          </div>
        )}
      </div>

      {/* Eval Runs */}
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        Evaluation Runs
      </h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <div key={run.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-mono text-xs text-muted-foreground">{run.id}</div>
              <div className="text-sm">{new Date(run.startTime).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-32 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${run.passRate * 100}%` }}
                />
              </div>
              <span className="text-sm font-mono font-bold">{(run.passRate * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
        {runs.length === 0 && (
          <div className="text-center text-muted-foreground py-8 bg-card border border-border rounded-lg">
            No evaluation runs yet.
          </div>
        )}
      </div>
    </div>
  );
}

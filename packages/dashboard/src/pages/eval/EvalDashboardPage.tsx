/**
 * Eval Dashboard — 评估中心
 *
 * 用于管理评估数据集和查看评估结果。
 * 评估 = Agent 的"单元测试"，量化 Prompt 迭代效果。
 */

import { useState, useEffect } from 'react';
import { Plus, TrendingUp, X, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null);
  const [newItemInput, setNewItemInput] = useState('');
  const [newItemExpected, setNewItemExpected] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  const loadData = () => {
    api.getDatasets().then((data) => setDatasets(data as Dataset[])).catch(console.error);
    api.getEvalRuns().then((data) => setRuns(data as EvalRun[])).catch(console.error);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateDataset = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await api.createDataset(newName.trim(), newDescription.trim() || undefined);
      setNewName('');
      setNewDescription('');
      setShowCreateModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to create dataset:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleAddItem = async (datasetId: string) => {
    if (!newItemInput.trim() || addingItem) return;
    setAddingItem(true);
    try {
      await api.addDatasetItem(datasetId, {
        input: newItemInput.trim(),
        expectedOutput: newItemExpected.trim() || undefined,
      });
      setNewItemInput('');
      setNewItemExpected('');
      loadData();
    } catch (err) {
      console.error('Failed to add item:', err);
    } finally {
      setAddingItem(false);
    }
  };

  const toggleDataset = (id: string) => {
    setExpandedDataset((prev) => (prev === id ? null : id));
    setNewItemInput('');
    setNewItemExpected('');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Eval & Regression</h2>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-1" />
          New Dataset
        </Button>
      </div>

      {/* Datasets */}
      <div className="space-y-3 mb-8">
        {datasets.map((ds) => {
          const items = JSON.parse(ds.items || '[]');
          const isExpanded = expandedDataset === ds.id;
          const datasetRuns = runs.filter((r) => r.datasetId === ds.id);

          return (
            <Card key={ds.id} className="hover:border-primary/30 transition-colors">
              <div
                className="p-4 cursor-pointer flex items-start justify-between"
                onClick={() => toggleDataset(ds.id)}
              >
                <div className="flex items-start gap-3">
                  <button className="mt-0.5 text-muted-foreground">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div>
                    <h3 className="font-semibold text-foreground">{ds.name}</h3>
                    {ds.description && (
                      <p className="text-sm text-muted-foreground">{ds.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="muted">{items.length} test cases</Badge>
                      <span className="text-sm text-muted-foreground">
                        Created {new Date(ds.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                  {/* Items list */}
                  {items.length > 0 ? (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Test Cases</h4>
                      <div className="space-y-2">
                        {items.map((item: { input: string; expectedOutput?: string; id?: string }, idx: number) => (
                          <div key={item.id || idx} className="bg-secondary/50 rounded p-2 text-sm">
                            <div className="text-sm text-muted-foreground mb-0.5">Input:</div>
                            <div className="mb-1 text-base">{item.input}</div>
                            {item.expectedOutput && (
                              <>
                                <div className="text-sm text-muted-foreground mb-0.5">Expected:</div>
                                <div className="text-emerald-700">{item.expectedOutput}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No test cases yet.</p>
                  )}

                  {/* Add item form */}
                  <div className="border-t border-border pt-3 space-y-2">
                    <h4 className="text-sm font-medium text-foreground">Add Test Case</h4>
                    <Input
                      placeholder="Input..."
                      value={newItemInput}
                      onChange={(e) => setNewItemInput(e.target.value)}
                    />
                    <Input
                      placeholder="Expected output (optional)..."
                      value={newItemExpected}
                      onChange={(e) => setNewItemExpected(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddItem(ds.id)}
                      disabled={!newItemInput.trim() || addingItem}
                    >
                      {addingItem ? 'Adding...' : 'Add Item'}
                    </Button>
                  </div>

                  {/* Dataset runs */}
                  {datasetRuns.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <h4 className="text-sm font-medium text-foreground mb-2">Recent Runs</h4>
                      <div className="space-y-1">
                        {datasetRuns.slice(0, 5).map((run) => (
                          <div key={run.id} className="flex items-center gap-3 text-sm">
                            <span className="text-sm text-muted-foreground font-mono">
                              {new Date(run.startTime).toLocaleString()}
                            </span>
                            <div className="h-1.5 w-24 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 transition-all"
                                style={{ width: `${run.passRate * 100}%` }}
                              />
                            </div>
                            <span className="font-mono text-sm font-bold">
                              {(run.passRate * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {datasets.length === 0 && (
          <div className="text-center text-muted-foreground py-12 bg-card border border-border rounded-lg">
            <p>No datasets yet. Create one to start evaluating your agents.</p>
          </div>
        )}
      </div>

      {/* Evaluation Runs (All) */}
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-foreground">
        <TrendingUp className="w-4 h-4" />
        All Evaluation Runs
      </h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <Card key={run.id} className="p-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-mono text-sm text-muted-foreground">{run.id}</div>
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
          </Card>
        ))}
        {runs.length === 0 && (
          <Card className="text-center text-muted-foreground py-8">
            No evaluation runs yet.
          </Card>
        )}
      </div>

      {/* Create Dataset Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-96 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Create Dataset</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">Name</label>
                <Input
                  placeholder="Dataset name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDataset()}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Description (optional)
                </label>
                <Textarea
                  placeholder="Brief description..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateDataset} disabled={!newName.trim() || creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

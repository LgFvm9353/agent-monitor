/**
 * Trace Explorer ⭐ — 单次 Run 详情页（最小可行版）
 *
 * 展示：
 * 1. Trace 列表（左侧面板）
 * 2. Runtime Events Timeline / Event List（主区域）
 * 3. Event Detail Panel（右侧详情）
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTraceStore, type RuntimeEvent } from '../../store/traceStore';
import { useAgentTrace } from '../../hooks/useAgentTrace';
import { api } from '../../lib/api';
import { TokenBar } from '../../components/trace/TokenBar';

function formatDateTime(timestamp?: number | null): string {
  if (!timestamp) {
    return '-';
  }

  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(durationMs?: number | null, startTime?: number | null, endTime?: number | null): string {
  if (typeof durationMs === 'number') {
    return `${durationMs}ms`;
  }

  if (typeof startTime === 'number' && typeof endTime === 'number') {
    return `${Math.max(endTime - startTime, 0)}ms`;
  }

  return '-';
}

function getStatusClassName(status: string): string {
  switch (status) {
    case 'completed':
    case 'ok':
    case 'success':
      return 'text-green-600';
    case 'running':
    case 'pending':
      return 'text-amber-600';
    case 'failed':
    case 'error':
      return 'text-red-600';
    default:
      return 'text-muted-foreground';
  }
}

function getKindDotClassName(kind: string): string {
  switch (kind) {
    case 'llm':
      return 'bg-violet-500';
    case 'tool':
      return 'bg-cyan-500';
    case 'agent':
      return 'bg-indigo-500';
    case 'system':
      return 'bg-orange-500';
    default:
      return 'bg-slate-500';
  }
}

function getEventBarStyle(event: RuntimeEvent, minStartTime: number, maxEndTime: number): { left: string; width: string } {
  const total = Math.max(maxEndTime - minStartTime, 1);
  const eventStart = event.startTime;
  const eventEnd = event.endTime ?? event.startTime + (event.durationMs ?? 0);
  const safeEnd = Math.max(eventEnd, eventStart);
  const left = ((eventStart - minStartTime) / total) * 100;
  const width = Math.max(((safeEnd - eventStart) / total) * 100, 1.5);

  return {
    left: `${left}%`,
    width: `${width}%`,
  };
}

export function TraceExplorerPage() {
  const { traceId } = useParams();
  const {
    traces,
    selectedTraceId,
    selectedTrace,
    selectedRuntimeEvents,
    selectedEventId,
    isLoading,
    runDetailError,
    setTraces,
    selectTrace,
    selectEvent,
    setRunDetail,
    resetRunDetail,
    setLoading,
    setError,
  } = useTraceStore();
  const { isConnected, subscribe } = useAgentTrace();

  const selectedEvent = useMemo(
    () => selectedRuntimeEvents.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, selectedRuntimeEvents],
  );

  const timelineBounds = useMemo(() => {
    if (selectedRuntimeEvents.length === 0) {
      return null;
    }

    const minStartTime = Math.min(...selectedRuntimeEvents.map((event) => event.startTime));
    const maxEndTime = Math.max(
      ...selectedRuntimeEvents.map((event) => event.endTime ?? event.startTime + (event.durationMs ?? 0)),
    );

    return {
      minStartTime,
      maxEndTime: Math.max(maxEndTime, minStartTime + 1),
    };
  }, [selectedRuntimeEvents]);

  const loadRunDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const detail = await api.getRunDetail(id);
      setRunDetail(detail);
      subscribe(id);
    } catch (error) {
      resetRunDetail();
      selectTrace(id);
      setError(error instanceof Error ? error.message : '加载运行详情失败');
    } finally {
      setLoading(false);
    }
  }, [resetRunDetail, selectTrace, setError, setLoading, setRunDetail, subscribe]);

  useEffect(() => {
    api.getTraces()
      .then((data) => setTraces(data))
      .catch((error) => {
        console.error('[TraceExplorerPage] Failed to load traces:', error);
      });
  }, [setTraces]);

  useEffect(() => {
    if (!traceId) {
      return;
    }

    void loadRunDetail(traceId);
  }, [loadRunDetail, traceId]);

  return (
    <div className="flex h-full gap-4">
      <div className="w-72 flex-shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Traces</h3>
          <span
            className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={isConnected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
          />
        </div>
        <div className="max-h-[calc(100vh-120px)] space-y-1 overflow-y-auto">
          {traces.map((trace) => {
            const isActive = selectedTraceId === trace.id;

            return (
              <button
                key={trace.id}
                onClick={() => {
                  void loadRunDetail(trace.id);
                }}
                className={`w-full rounded-md border p-3 text-left text-sm transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-sm text-muted-foreground">{trace.id}</span>
                  <span className={`text-sm ${trace.success ? 'text-green-600' : 'text-red-600'}`}>
                    {trace.success ? '✓' : '✗'}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {trace.model} · {trace.durationMs}ms
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {trace.inputTokens + trace.outputTokens} tokens
                  {trace.estimatedCost ? ` · $${trace.estimatedCost.toFixed(4)}` : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedTrace ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate font-mono text-lg text-foreground">
                  {selectedTrace.id}
                </h3>
                <div className="mt-1 text-sm text-foreground">
                  Model: {selectedTrace.model} · Duration: {selectedTrace.durationMs}ms ·
                  {selectedTrace.success ? (
                    <span className="text-green-600"> Success</span>
                  ) : (
                    <span className="text-red-600"> Failed</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Created At: {formatDateTime(selectedTrace.createdAt)}
                </div>
              </div>
              <TokenBar inputTokens={selectedTrace.inputTokens} outputTokens={selectedTrace.outputTokens} />
            </div>

            {runDetailError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {runDetailError}
              </div>
            ) : null}

            <div className="grid min-h-[calc(100vh-220px)] grid-cols-12 gap-4">
              <div className="col-span-7 space-y-4">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-foreground">Timeline</h4>
                    <span className="text-xs text-muted-foreground">
                      {selectedRuntimeEvents.length} events
                    </span>
                  </div>

                  {selectedRuntimeEvents.length > 0 && timelineBounds ? (
                    <div className="space-y-3">
                      {selectedRuntimeEvents.map((event) => {
                        const barStyle = getEventBarStyle(event, timelineBounds.minStartTime, timelineBounds.maxEndTime);
                        const isSelected = event.id === selectedEventId;

                        return (
                          <button
                            key={event.id}
                            onClick={() => selectEvent(event.id)}
                            className={`w-full rounded-md border p-3 text-left transition-colors ${
                              isSelected
                                ? 'border-primary/30 bg-primary/5'
                                : 'border-border hover:bg-accent'
                            }`}
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <span className={`inline-block h-2 w-2 rounded-full ${getKindDotClassName(event.kind)}`} />
                              <span className="truncate text-sm font-medium text-foreground">{event.name}</span>
                              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {event.kind}
                              </span>
                              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {event.eventType}
                              </span>
                              <span className={`ml-auto text-xs ${getStatusClassName(event.status)}`}>
                                {event.status}
                              </span>
                            </div>
                            <div className="relative h-8 rounded bg-muted/60">
                              <div
                                className={`absolute top-1/2 h-4 -translate-y-1/2 rounded ${getKindDotClassName(event.kind)}`}
                                style={barStyle}
                              />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                              <span>{formatDateTime(event.startTime)}</span>
                              <span>{formatDuration(event.durationMs, event.startTime, event.endTime)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                      {isLoading ? '正在加载 timeline...' : '当前运行暂无 runtime events'}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-foreground">Event List</h4>
                    <span className="text-xs text-muted-foreground">
                      按开始时间排序
                    </span>
                  </div>

                  {selectedRuntimeEvents.length > 0 ? (
                    <div className="space-y-2">
                      {selectedRuntimeEvents.map((event) => {
                        const isSelected = event.id === selectedEventId;

                        return (
                          <button
                            key={event.id}
                            onClick={() => selectEvent(event.id)}
                            className={`flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors ${
                              isSelected
                                ? 'border-primary/30 bg-primary/5'
                                : 'border-border hover:bg-accent'
                            }`}
                          >
                            <span className={`inline-block h-2 w-2 rounded-full ${getKindDotClassName(event.kind)}`} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">{event.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{event.kind}</span>
                                <span>·</span>
                                <span>{event.eventType}</span>
                                <span>·</span>
                                <span>{formatDateTime(event.startTime)}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-xs ${getStatusClassName(event.status)}`}>{event.status}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {formatDuration(event.durationMs, event.startTime, event.endTime)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                      {isLoading ? '正在加载事件列表...' : '暂无事件可展示'}
                    </div>
                  )}
                </div>
              </div>

              <div className="col-span-5">
                <div className="h-full rounded-lg border border-border bg-card p-4">
                  <h4 className="mb-3 text-sm font-medium text-foreground">Detail Panel</h4>

                  {selectedEvent ? (
                    <div className="space-y-4 text-sm">
                      <div>
                        <div className="text-base font-semibold text-foreground">{selectedEvent.name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded bg-muted px-2 py-0.5">{selectedEvent.kind}</span>
                          <span className="rounded bg-muted px-2 py-0.5">{selectedEvent.eventType}</span>
                          <span className={`rounded bg-muted px-2 py-0.5 ${getStatusClassName(selectedEvent.status)}`}>
                            {selectedEvent.status}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Event ID:</span> <span className="font-mono">{selectedEvent.id}</span></div>
                        <div><span className="text-muted-foreground">Trace ID:</span> <span className="font-mono">{selectedEvent.traceId}</span></div>
                        <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono">{selectedEvent.runId}</span></div>
                        <div><span className="text-muted-foreground">Parent ID:</span> <span className="font-mono">{selectedEvent.parentId || '-'}</span></div>
                        <div><span className="text-muted-foreground">Step ID:</span> <span className="font-mono">{selectedEvent.stepId || '-'}</span></div>
                        <div><span className="text-muted-foreground">Start Time:</span> <span>{formatDateTime(selectedEvent.startTime)}</span></div>
                        <div><span className="text-muted-foreground">End Time:</span> <span>{formatDateTime(selectedEvent.endTime)}</span></div>
                        <div><span className="text-muted-foreground">Duration:</span> <span>{formatDuration(selectedEvent.durationMs, selectedEvent.startTime, selectedEvent.endTime)}</span></div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Input</div>
                          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                            {selectedEvent.input || '-'}
                          </pre>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output Summary</div>
                          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                            {selectedEvent.outputSummary || '-'}
                          </pre>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Error</div>
                          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                            {selectedEvent.error || '-'}
                          </pre>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata</div>
                          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                            {selectedEvent.metadata || '-'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
                      {isLoading ? '正在加载事件详情...' : '请选择一个 event 查看详情'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {isLoading ? '正在加载运行详情...' : 'Select a trace from the list to view run details'}
          </div>
        )}
      </div>
    </div>
  );
}

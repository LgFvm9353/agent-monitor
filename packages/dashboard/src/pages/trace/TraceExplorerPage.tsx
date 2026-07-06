/**
 * Trace Explorer ⭐ — Agent 执行追踪详情页（核心亮点页面）
 *
 * 展示：
 * 1. Trace 列表（左侧面板）
 * 2. 火焰图/时间线视图（主区域，类似 Chrome DevTools Performance）
 * 3. Token 分析和 Prompt 查看
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTraceStore, type TraceSummary } from '../../store/traceStore';
import { useAgentTrace } from '../../hooks/useAgentTrace';
import { api } from '../../lib/api';
import { FlameGraph } from '../../components/trace/FlameGraph';
import { TokenBar } from '../../components/trace/TokenBar';

export function TraceExplorerPage() {
  const { traceId } = useParams();
  const { traces, setTraces, selectTrace, selectedTraceId, selectedTraceSpans, setSpans } = useTraceStore();
  const { isConnected, subscribe } = useAgentTrace();
  const [selectedTrace, setSelectedTrace] = useState<TraceSummary | null>(null);

  // 加载 Trace 列表
  useEffect(() => {
    api.getTraces().then((data) => setTraces(data as TraceSummary[])).catch(console.error);
  }, [setTraces]);

  // URL 路由携带 traceId 时，自动选中
  useEffect(() => {
    if (traceId) {
      selectTrace(traceId);
      subscribe(traceId);
      api.getTrace(traceId).then((data) => {
        setSelectedTrace((data as { trace: TraceSummary }).trace);
        setSpans((data as { spans: Parameters<typeof setSpans>[0] }).spans);
      }).catch(console.error);
    }
  }, [traceId, selectTrace, subscribe, setSpans]);

  return (
    <div className="flex h-full gap-4">
      {/* Trace List Sidebar */}
      <div className="w-72 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-foreground">Traces</h3>
          <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
        <div className="space-y-1 max-h-[calc(100vh-120px)] overflow-y-auto">
          {traces.map((trace) => (
            <button
              key={trace.id}
              onClick={() => {
                selectTrace(trace.id);
                subscribe(trace.id);
                setSelectedTrace(trace);
                api.getTrace(trace.id).then((data) => {
                  setSpans((data as { spans: Parameters<typeof setSpans>[0] }).spans);
                });
              }}
              className={`w-full text-left p-3 rounded-md text-sm transition-colors ${
                selectedTraceId === trace.id
                  ? 'bg-primary/10 border border-primary/30'
                  : 'border border-border hover:bg-accent'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-mono text-sm text-muted-foreground truncate">{trace.id}</span>
                <span className={`text-sm ${trace.success ? 'text-green-600' : 'text-red-600'}`}>
                  {trace.success ? '✓' : '✗'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">{trace.model} · {trace.durationMs}ms</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {trace.inputTokens + trace.outputTokens} tokens
                {trace.estimatedCost ? ` · $${trace.estimatedCost.toFixed(4)}` : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Trace View */}
      <div className="flex-1">
        {selectedTrace ? (
          <div className="space-y-4">
            {/* Trace Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold font-mono text-sm text-foreground">
                  {selectedTrace.id}
                </h3>
                <div className="text-sm text-foreground mt-1">
                  Model: {selectedTrace.model} · Duration: {selectedTrace.durationMs}ms ·
                  {selectedTrace.success ? (
                    <span className="text-green-600"> Success</span>
                  ) : (
                    <span className="text-red-600"> Failed</span>
                  )}
                </div>
              </div>
              <TokenBar inputTokens={selectedTrace.inputTokens} outputTokens={selectedTrace.outputTokens} />
            </div>

            {/* Flame Graph */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">
                Trace Timeline (Flame Graph)
              </h4>
              <FlameGraph spans={selectedTraceSpans} />
            </div>

            {/* Span Details */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Span Details</h4>
              <div className="space-y-2">
                {selectedTraceSpans.map((span) => (
                  <div key={span.id} className="flex items-center gap-3 text-sm p-2 rounded hover:bg-accent">
                    <span className={`inline-block w-2 h-2 rounded-full bg-${span.type === 'llm' ? 'purple' : span.type === 'tool' ? 'cyan' : 'indigo'}-500`} />
                    <span className="font-medium min-w-[100px]">{span.name}</span>
                    <span className="text-muted-foreground text-sm">{span.type}</span>
                    <span className="text-muted-foreground text-sm ml-auto">
                      {span.endTime - span.startTime}ms
                    </span>
                    <span className={`text-sm ${span.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                      {span.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a trace from the list to view details
          </div>
        )}
      </div>
    </div>
  );
}

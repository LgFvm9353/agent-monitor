/**
 * FlameGraph — Agent Trace 火焰图组件 ⭐
 *
 * 类似 Chrome DevTools Performance 面板的火焰图，
 * 可视化展示 Agent 执行的完整时间线：
 * [Agent思考] ████████████ 3.2s
 *   ├─ [Tool: search] ████ 0.8s
 *   ├─ [Tool: read] ██ 0.3s
 *   └─ [Tool: write] █████ 1.1s
 * [Model Response] ██ 0.5s
 */

import type { SpanData } from '../../store/traceStore';

interface FlameGraphProps {
  spans: SpanData[];
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string) => void;
}

interface FlattenedSpan {
  span: SpanData;
  depth: number;
}

const TYPE_COLORS: Record<string, string> = {
  agent: '#6366f1',      // indigo
  llm: '#8b5cf6',        // purple
  tool: '#06b6d4',       // cyan
  middleware: '#f59e0b', // amber
  memory: '#10b981',     // emerald
};

function buildSpanRows(spans: SpanData[]): FlattenedSpan[] {
  const spanMap = new Map(spans.map((span) => [span.id, { ...span, children: [] as SpanData[] }]));
  const roots: SpanData[] = [];

  for (const span of spanMap.values()) {
    if (span.parentSpanId) {
      const parent = spanMap.get(span.parentSpanId);
      if (parent) {
        parent.children.push(span);
        continue;
      }
    }

    roots.push(span);
  }

  const sortByStartTime = (items: SpanData[]) => {
    items.sort((a, b) => a.startTime - b.startTime);
    items.forEach((item) => sortByStartTime(item.children));
  };

  sortByStartTime(roots);

  const rows: FlattenedSpan[] = [];

  const visit = (span: SpanData, depth: number) => {
    rows.push({ span, depth });
    span.children.forEach((child) => visit(child, depth + 1));
  };

  roots.forEach((root) => visit(root, 0));

  return rows;
}

export function FlameGraph({ spans, selectedSpanId = null, onSelectSpan }: FlameGraphProps) {
  if (!spans || spans.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No span data available
      </div>
    );
  }

  const rows = buildSpanRows(spans);
  const minTime = Math.min(...rows.map(({ span }) => span.startTime));
  const maxTime = Math.max(...rows.map(({ span }) => span.endTime));
  const totalDuration = maxTime - minTime || 1;

  return (
    <div className="font-mono text-xs">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background/40">
        <div className="grid grid-cols-[240px_minmax(0,1fr)_72px] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Span</span>
          <span>Timeline</span>
          <span className="text-right">Time</span>
        </div>

        <div className="space-y-1 p-2">
          {rows.map(({ span, depth }) => {
            const leftPercent = ((span.startTime - minTime) / totalDuration) * 100;
            const widthPercent = ((span.endTime - span.startTime) / totalDuration) * 100;
            const duration = span.endTime - span.startTime;
            const isSelected = span.id === selectedSpanId;

            return (
              <button
                key={span.id}
                type="button"
                onClick={() => onSelectSpan?.(span.id)}
                className={`grid h-9 w-full grid-cols-[240px_minmax(0,1fr)_72px] items-center gap-3 rounded-md border px-2 text-left transition-colors ${
                  isSelected
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-transparent hover:border-border hover:bg-accent/50'
                }`}
                title={`${span.name} — ${duration}ms`}
              >
                <div className="min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: TYPE_COLORS[span.type] || '#6b7280' }}
                    />
                    <span className="truncate text-xs font-medium text-foreground">{span.name}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{span.type} · {span.status}</div>
                </div>

                <div className="relative h-5 overflow-hidden rounded bg-muted/60">
                  <div className="absolute inset-0 grid grid-cols-4">
                    <span className="border-r border-dashed border-border/60" />
                    <span className="border-r border-dashed border-border/60" />
                    <span className="border-r border-dashed border-border/60" />
                    <span />
                  </div>
                  <div
                    className="absolute inset-y-0 rounded px-2 text-white shadow-sm"
                    style={{
                      left: `${Math.max(leftPercent, 0.5)}%`,
                      width: `${Math.max(widthPercent, 1)}%`,
                      backgroundColor: TYPE_COLORS[span.type] || '#6b7280',
                    }}
                  >
                    <span className="block truncate leading-5">{span.name}</span>
                  </div>
                </div>

                <div className="text-right text-[11px] text-muted-foreground">{duration}ms</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mt-2 h-5 border-t border-border">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <div
            key={ratio}
            className="absolute -top-1 text-[10px] text-muted-foreground"
            style={{ left: `${ratio * 100}%`, transform: 'translateX(-50%)' }}
          >
            {(totalDuration * ratio).toFixed(0)}ms
          </div>
        ))}
      </div>
    </div>
  );
}

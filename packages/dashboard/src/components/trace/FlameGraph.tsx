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
}

const TYPE_COLORS: Record<string, string> = {
  agent: '#6366f1',      // indigo
  llm: '#8b5cf6',        // purple
  tool: '#06b6d4',       // cyan
  middleware: '#f59e0b', // amber
  memory: '#10b981',     // emerald
};

export function FlameGraph({ spans }: FlameGraphProps) {
  if (!spans || spans.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No span data available
      </div>
    );
  }

  // 计算时间范围
  const minTime = Math.min(...spans.map((s) => s.startTime));
  const maxTime = Math.max(...spans.map((s) => s.endTime));
  const totalDuration = maxTime - minTime || 1;

  return (
    <div className="font-mono text-xs">
      {/* Legend */}
      <div className="flex gap-4 mb-3">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>

      {/* Flame bars */}
      <div className="space-y-1.5">
        {spans.map((span) => {
          const leftPercent = ((span.startTime - minTime) / totalDuration) * 100;
          const widthPercent = ((span.endTime - span.startTime) / totalDuration) * 100;
          const duration = span.endTime - span.startTime;

          return (
            <div key={span.id} className="relative h-7 group">
              {/* Time axis background */}
              <div className="absolute inset-0 bg-secondary rounded" />

              {/* Flame bar */}
              <div
                className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden whitespace-nowrap transition-opacity hover:opacity-80 cursor-default"
                style={{
                  left: `${Math.max(leftPercent, 0.5)}%`,
                  width: `${Math.max(widthPercent, 1)}%`,
                  backgroundColor: TYPE_COLORS[span.type] || '#6b7280',
                }}
                title={`${span.name} — ${duration}ms`}
              >
                <span className="truncate text-white font-medium">
                  {span.name}
                </span>
              </div>

              {/* Tooltip on hover */}
              <div className="absolute top-full mt-1 left-0 bg-gray-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none whitespace-nowrap">
                {span.name} · {span.type} · {duration}ms · {span.status}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time axis ruler */}
      <div className="relative h-5 mt-2 border-t border-border">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <div
            key={ratio}
            className="absolute text-[10px] text-muted-foreground -top-1"
            style={{ left: `${ratio * 100}%`, transform: 'translateX(-50%)' }}
          >
            {(totalDuration * ratio).toFixed(0)}ms
          </div>
        ))}
      </div>
    </div>
  );
}

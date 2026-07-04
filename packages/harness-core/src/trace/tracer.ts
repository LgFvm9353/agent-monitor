/**
 * Trace System — Agent 执行追踪系统
 *
 * 基于 OpenTelemetry 理念的轻量级 Trace 实现。
 *
 * Trace 结构：
 *   Trace
 *     └── Root Span (agent-run)
 *           ├── Span (llm-call) ── 包含 prompt/tokens
 *           ├── Span (tool:search) ── 包含 args/result
 *           ├── Span (tool:read) ── 包含 args/result
 *           └── Span (llm-call) ── 包含 response/tokens
 *
 * 这个 Span 树是 Dashboard 火焰图的数据来源。
 */

import type { AgentTrace, AgentSpan, TraceMetadata, SpanType, SpanStatus, TokenUsage } from '../types';

interface SpanRecord {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  children: string[]; // child spanIds
}

class Tracer {
  private traces = new Map<string, {
    rootSpanId: string;
    spans: Map<string, SpanRecord>;
    metadata?: Partial<TraceMetadata>;
  }>();

  /** 开始一个 Trace */
  startTrace(name: string, metadata?: Partial<TraceMetadata>): string {
    const traceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const rootSpanId = `${traceId}-root`;

    this.traces.set(traceId, {
      rootSpanId,
      spans: new Map(),
      metadata,
    });

    const rootSpan: SpanRecord = {
      spanId: rootSpanId,
      name,
      type: 'agent',
      startTime: Date.now(),
      status: { code: 'ok' },
      children: [],
    };
    this.traces.get(traceId)!.spans.set(rootSpanId, rootSpan);

    return traceId;
  }

  /** 创建一个 Span */
  startSpan(
    traceId: string,
    name: string,
    type: SpanType,
    metadata?: Record<string, unknown>,
    parentSpanId?: string,
  ): string {
    const trace = this.traces.get(traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);

    const spanId = `${traceId}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 4)}`;
    const actualParentId = parentSpanId || trace.rootSpanId;

    const span: SpanRecord = {
      spanId,
      parentSpanId: actualParentId,
      name,
      type,
      startTime: Date.now(),
      status: { code: 'ok' },
      metadata,
      children: [],
    };

    // 添加到父 Span 的 children 列表
    const parent = trace.spans.get(actualParentId);
    if (parent) {
      parent.children.push(spanId);
    }

    trace.spans.set(spanId, span);
    return spanId;
  }

  /** 结束一个 Span */
  endSpan(spanId: string, output?: unknown, statusCode?: 'ok' | 'error' | 'cancelled', message?: string): void {
    for (const trace of this.traces.values()) {
      const span = trace.spans.get(spanId);
      if (span) {
        span.endTime = Date.now();
        span.output = output;
        span.status = { code: statusCode || 'ok', message };
        return;
      }
    }
  }

  /** 结束整个 Trace */
  endTrace(traceId: string, metadata?: Partial<TraceMetadata>): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    if (metadata) {
      trace.metadata = { ...trace.metadata, ...metadata };
    }

    // 确保所有未结束的 Span 被关闭
    for (const span of trace.spans.values()) {
      if (!span.endTime) {
        span.endTime = Date.now();
      }
    }
  }

  /** 获取完整的 AgentTrace 结构 */
  getTrace(traceId: string): AgentTrace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    const buildSpanTree = (spanId: string): AgentSpan | null => {
      const record = trace.spans.get(spanId);
      if (!record) return null;

      return {
        spanId: record.spanId,
        parentSpanId: record.parentSpanId,
        name: record.name,
        type: record.type,
        startTime: record.startTime,
        endTime: record.endTime || Date.now(),
        input: record.input,
        output: record.output,
        status: record.status,
        metadata: record.metadata,
        children: record.children
          .map((childId) => buildSpanTree(childId))
          .filter((s): s is AgentSpan => s !== null),
      };
    };

    const rootSpan = buildSpanTree(trace.rootSpanId);
    if (!rootSpan) return null;

    return {
      traceId,
      sessionId: (trace.metadata?.sessionId) || '',
      rootSpan,
      metadata: {
        startTime: trace.metadata?.startTime || rootSpan.startTime,
        endTime: trace.metadata?.endTime || rootSpan.endTime,
        model: trace.metadata?.model || 'unknown',
        tokens: trace.metadata?.tokens || { input: 0, output: 0 },
        success: trace.metadata?.success ?? true,
        error: trace.metadata?.error,
        tags: trace.metadata?.tags,
      },
    };
  }

  /** 列出所有 Trace ID */
  listTraces(): string[] {
    return Array.from(this.traces.keys());
  }

  /** 清除旧的 Traces */
  clear(): void {
    this.traces.clear();
  }
}

// 全局单例
let globalTracer: Tracer | null = null;

export function createTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

export function getGlobalTracer(): Tracer {
  return createTracer();
}

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
 *
 * 每个 AgentRunner 拥有自己的 Tracer 实例（支持并发 Agent）。
 */

import type { AgentTrace, AgentSpan, TraceMetadata, SpanType, SpanStatus } from '../types';
import type { RuntimeEvent, RuntimeEventKind, RuntimeEventStatus } from '../agent/types';

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

export class Tracer {
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
      sessionId: (trace.metadata as Record<string, unknown>)?.sessionId as string || trace.metadata?.sessionId || '',
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

// 工厂函数（创建新实例，不再全局单例）
export function createTracer(): Tracer {
  return new Tracer();
}

/**
 * @deprecated 使用 `new Tracer()` 或 `createTracer()` 创建独立实例。
 * 保留此函数仅为向后兼容，返回全局共享实例。
 */
let _globalTracer: Tracer | null = null;
export function getGlobalTracer(): Tracer {
  if (!_globalTracer) {
    _globalTracer = new Tracer();
  }
  return _globalTracer;
}

export interface RuntimeEventDraft {
  traceId: string;
  runId: string;
  parentId?: string;
  stepId?: string;
  kind: RuntimeEventKind;
  eventType: string;
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

export class RuntimeEventRecorder {
  private events: RuntimeEvent[] = [];
  private activeEvents = new Map<string, RuntimeEvent>();

  start(draft: RuntimeEventDraft): RuntimeEvent {
    const event: RuntimeEvent = {
      eventId: this.generateId(draft.kind),
      traceId: draft.traceId,
      runId: draft.runId,
      parentId: draft.parentId,
      stepId: draft.stepId,
      kind: draft.kind,
      eventType: draft.eventType,
      name: draft.name,
      status: 'started',
      startTime: Date.now(),
      input: draft.input,
      metadata: draft.metadata,
    };

    this.events.push(event);
    this.activeEvents.set(event.eventId, event);
    return event;
  }

  complete(eventId: string, outputSummary?: unknown, metadata?: Record<string, unknown>): RuntimeEvent | null {
    return this.finish(eventId, 'completed', { outputSummary, metadata });
  }

  fail(eventId: string, error: string, metadata?: Record<string, unknown>): RuntimeEvent | null {
    return this.finish(eventId, 'failed', { error, metadata });
  }

  getAll(): RuntimeEvent[] {
    return this.events.map((event) => ({
      ...event,
      metadata: event.metadata ? { ...event.metadata } : undefined,
    }));
  }

  clear(): void {
    this.events = [];
    this.activeEvents.clear();
  }

  private finish(
    eventId: string,
    status: RuntimeEventStatus,
    patch: { outputSummary?: unknown; error?: string; metadata?: Record<string, unknown> },
  ): RuntimeEvent | null {
    const event = this.activeEvents.get(eventId);
    if (!event) return null;

    event.status = status;
    event.endTime = Date.now();
    event.durationMs = event.endTime - event.startTime;
    if (patch.outputSummary !== undefined) {
      event.outputSummary = patch.outputSummary;
    }
    if (patch.error !== undefined) {
      event.error = patch.error;
    }
    if (patch.metadata) {
      event.metadata = {
        ...(event.metadata || {}),
        ...patch.metadata,
      };
    }
    this.activeEvents.delete(eventId);
    return event;
  }

  private generateId(kind: RuntimeEventKind): string {
    return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ===== Step Recorder =====

/**
 * 可序列化的步骤记录
 *
 * 记录 Agent 执行过程中每一步的完整状态，
 * 用于事后回放和调试。
 */
export interface StepRecord {
  /** 步骤序号 */
  stepIndex: number;
  /** 步骤类型 */
  type: 'llm_call' | 'tool_call' | 'middleware' | 'error';
  /** 步骤名称 */
  name: string;
  /** 输入数据（可序列化） */
  input?: unknown;
  /** 输出数据（可序列化） */
  output?: unknown;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
  /** Token 消耗 */
  tokens?: { input: number; output: number };
  /** 错误信息 */
  error?: string;
  /** 当前消息历史快照 */
  messageSnapshot?: Array<{ role: string; content: string }>;
}

/**
 * StepRecorder — 步骤记录器
 *
 * 记录 Agent 执行的每个步骤，支持回放和导出。
 * 每个 AgentRunner 可配置一个 StepRecorder。
 */
export class StepRecorder {
  private steps: StepRecord[] = [];
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session-${Date.now().toString(36)}`;
  }

  /** 记录一个步骤 */
  record(step: StepRecord): void {
    this.steps.push(step);
  }

  /** 获取所有步骤 */
  getAll(): StepRecord[] {
    return [...this.steps];
  }

  /** 获取指定 stepIndex 的步骤 */
  getStep(stepIndex: number): StepRecord | undefined {
    return this.steps.find(s => s.stepIndex === stepIndex);
  }

  /** 导出为可回放的数据 */
  export(): { sessionId: string; steps: StepRecord[]; totalSteps: number } {
    return {
      sessionId: this.sessionId,
      steps: this.steps,
      totalSteps: this.steps.length,
    };
  }

  /** 导入回放数据 */
  import(data: { sessionId: string; steps: StepRecord[] }): void {
    this.sessionId = data.sessionId;
    this.steps = data.steps;
  }

  /** 清空 */
  clear(): void {
    this.steps = [];
  }

  /** 获取统计 */
  getStats(): {
    totalSteps: number;
    llmCalls: number;
    toolCalls: number;
    errors: number;
    totalDuration: number;
  } {
    const llmCalls = this.steps.filter(s => s.type === 'llm_call').length;
    const toolCalls = this.steps.filter(s => s.type === 'tool_call').length;
    const errors = this.steps.filter(s => s.error).length;
    const totalDuration = this.steps.length > 0
      ? this.steps[this.steps.length - 1].endTime - this.steps[0].startTime
      : 0;

    return { totalSteps: this.steps.length, llmCalls, toolCalls, errors, totalDuration };
  }
}

// ===== Breakpoint Manager =====

/**
 * 断点配置
 */
export interface Breakpoint {
  /** 触发断点的步骤类型 */
  onStepType?: 'llm_call' | 'tool_call' | 'middleware' | 'error';
  /** 触发断点的工具名（仅 tool_call 类型） */
  onToolName?: string;
  /** 触发断点的步骤号 */
  onStepIndex?: number;
  /** 条件函数 */
  condition?: (ctx: {
    currentStep: number;
    toolName?: string;
    output?: string;
  }) => boolean | Promise<boolean>;
  /** 断点 ID（用于删除） */
  id: string;
}

/**
 * BreakpointManager — 断点管理器
 *
 * 允许外部代码在 Agent 执行的特定阶段暂停执行。
 *
 * @example
 * ```ts
 * const bpm = new BreakpointManager();
 * bpm.add({
 *   id: 'before-write',
 *   onToolName: 'write_file',
 * });
 *
 * // Agent 执行循环中
 * if (bpm.shouldBreak({ currentStep: 3, toolName: 'write_file' })) {
 *   await bpm.waitForResume();
 * }
 * ```
 */
export class BreakpointManager {
  private breakpoints: Breakpoint[] = [];
  private resolveMap = new Map<string, () => void>();
  private isPausedMap = new Map<string, boolean>();

  /** 添加断点 */
  add(bp: Breakpoint): void {
    this.breakpoints.push(bp);
  }

  /** 删除断点 */
  remove(bpId: string): void {
    this.breakpoints = this.breakpoints.filter(b => b.id !== bpId);
  }

  /** 清除所有断点 */
  clearAll(): void {
    this.breakpoints = [];
    this.resolveMap.clear();
    this.isPausedMap.clear();
  }

  /**
   * 检查是否应该在此处暂停
   *
   * @returns 匹配的断点 ID 列表
   */
  async shouldBreak(ctx: {
    currentStep: number;
    stepType: 'llm_call' | 'tool_call' | 'middleware' | 'error';
    toolName?: string;
    output?: string;
  }): Promise<string[]> {
    const matched: string[] = [];
    for (const bp of this.breakpoints) {
      if (bp.onStepType && bp.onStepType !== ctx.stepType) continue;
      if (bp.onToolName && bp.onToolName !== ctx.toolName) continue;
      if (bp.onStepIndex !== undefined && bp.onStepIndex !== ctx.currentStep) continue;
      if (bp.condition) {
        const cond = await bp.condition(ctx);
        if (!cond) continue;
      }
      matched.push(bp.id);
    }
    return matched;
  }

  /**
   * 暂停执行，等待恢复
   *
   * @param bpId - 断点 ID（用于日志）
   * @param timeoutMs - 超时（默认 0 = 无限等待）
   * @returns 是否因超时而恢复
   */
  async waitForResume(bpId: string, timeoutMs = 0): Promise<boolean> {
    this.isPausedMap.set(bpId, true);

    return new Promise<boolean>((resolve) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.isPausedMap.delete(bpId);
            this.resolveMap.delete(bpId);
            resolve(true); // timeout
          }, timeoutMs)
        : null;

      this.resolveMap.set(bpId, () => {
        if (timer) clearTimeout(timer);
        this.isPausedMap.delete(bpId);
        this.resolveMap.delete(bpId);
        resolve(false); // resumed
      });
    });
  }

  /**
   * 恢复暂停的断点
   */
  resume(bpId: string): void {
    const resolve = this.resolveMap.get(bpId);
    if (resolve) resolve();
  }

  /**
   * 恢复所有暂停的断点
   */
  resumeAll(): void {
    for (const resolve of this.resolveMap.values()) {
      resolve();
    }
    this.resolveMap.clear();
    this.isPausedMap.clear();
  }

  /** 获取当前暂停的断点 */
  getPausedBreakpoints(): string[] {
    return Array.from(this.isPausedMap.keys());
  }
}

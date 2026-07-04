/**
 * TracePlugin — SSE 流式 Trace 追踪插件
 *
 * 监控 AI Agent SSE 流式响应的完整生命周期：
 *   开始 → 首字节(TTFB) → 数据块流 → 工具调用 → 阶段追踪 → 完成/错误/中断
 *
 * 参考 @jerry_aurora/sky-monitor-sdk 的 Trace 架构设计。
 *
 * 使用方式:
 *   monitor.use(new TracePlugin());
 *   const trace = monitor.createTrace({ aiMessageId: 'msg-1' });
 *   trace.start();
 *   trace.firstChunk();           // 首字节到达
 *   trace.toolStart('search', { query: '...' });
 *   trace.toolEnd('search', { toolCallId, success: true });
 *   trace.complete();
 */

import { ListenerPlugin } from '../core/plugin';
import type { MonitorCore } from '../core/types';
import type { TraceOptions, SSETraceEventType } from '../types';

// ===== 工具调用记录 =====

interface ToolRecord {
  name: string;
  startTime: number;
}

// ===== Trace 类 =====

export class Trace {
  /** Trace 唯一 ID */
  readonly traceId: string;
  /** 关联的 AI 消息 ID */
  readonly aiMessageId?: string;
  /** 前一次 Trace ID */
  readonly previousTraceId?: string;

  private monitor: MonitorCore;
  private state: 'idle' | 'started' | 'ended' = 'idle';
  private startTime: number | null = null;
  private firstChunkTime: number | null = null;
  private lastChunkTime: number | null = null;

  /** 阶段记录: phaseName → startTime */
  private phases: Map<string, number> = new Map();
  /** 工具调用记录: toolCallId → { name, startTime } */
  private tools: Map<string, ToolRecord> = new Map();
  /** 图片加载记录: imageUrl → startTime */
  private imageLoads: Map<string, number> = new Map();

  /** 停顿检测定时器 */
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private isStalled = false;
  private stallThreshold: number;

  constructor(monitor: MonitorCore, options: TraceOptions = {}) {
    this.monitor = monitor;
    this.traceId = this.generateId();
    this.aiMessageId = options.aiMessageId;
    this.previousTraceId = options.previousTraceId;
    this.stallThreshold = options.stallThreshold ?? 5000;
  }

  // ===== 生命周期 =====

  /** 标记 Trace 开始 */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'started';
    this.startTime = Date.now();

    this.track('sse_start');

    // 如果有关联的前一次 trace，记录重试事件
    if (this.previousTraceId) {
      this.track('user_retry', {
        previousTraceId: this.previousTraceId,
      });
    }
  }

  /** 首字节到达 — 计算 TTFB */
  firstChunk(): void {
    if (this.state !== 'started' || this.firstChunkTime !== null) return;
    this.firstChunkTime = Date.now();
    const ttfb = this.firstChunkTime - (this.startTime || this.firstChunkTime);
    this.track('sse_first_chunk', { ttfb });
  }

  /** 记录数据块 — 驱动停顿检测 */
  recordChunk(): void {
    if (this.state !== 'started') return;
    const now = Date.now();

    // 从停顿中恢复
    if (this.isStalled && this.lastChunkTime) {
      const stallDuration = now - this.lastChunkTime;
      this.track('sse_resume', { stallDuration });
      this.isStalled = false;
    }

    this.lastChunkTime = now;
    this.startStallDetection();
  }

  /** 流完成 */
  complete(): void {
    if (this.state !== 'started') return;
    this.state = 'ended';
    this.stopStallDetection();
    const ttlb = Date.now() - (this.startTime || Date.now());
    this.track('sse_complete', { ttlb });
  }

  /** 流出错 */
  error(error: string): void {
    if (this.state !== 'started') return;
    this.state = 'ended';
    this.stopStallDetection();
    const duration = Date.now() - (this.startTime || Date.now());
    this.track('sse_error', { error, duration });
  }

  /** 流被中断 */
  abort(reason?: string): void {
    if (this.state !== 'started') return;
    this.state = 'ended';
    this.stopStallDetection();
    const duration = Date.now() - (this.startTime || Date.now());
    this.track('sse_abort', { abortReason: reason, duration });
  }

  // ===== 阶段追踪 =====

  /** 阶段开始 */
  phaseStart(name: string): void {
    if (this.state !== 'started') return;
    this.phases.set(name, Date.now());
    this.track('phase_start', { phase: name });
  }

  /** 阶段结束 */
  phaseEnd(name: string): void {
    if (this.state !== 'started') return;
    const startTime = this.phases.get(name);
    if (startTime === undefined) return;

    const duration = Date.now() - startTime;
    this.phases.delete(name);
    this.track('phase_end', { phase: name, phaseDuration: duration });
  }

  // ===== 工具调用追踪 =====

  /** 工具调用开始 — 返回 toolCallId */
  toolStart(name: string, args?: Record<string, unknown>, toolCallId?: string): string {
    if (this.state !== 'started') return '';
    const id = toolCallId || this.generateId();

    this.tools.set(id, { name, startTime: Date.now() });
    this.track('tool_start', { toolCallId: id, toolName: name, toolArgs: args });

    return id;
  }

  /** 工具调用结束 — 通过 toolCallId 或 name 匹配 */
  toolEnd(
    identifier: string,
    result: {
      success: boolean;
      resultCount?: number;
      error?: string;
      imageUrl?: string;
      width?: number;
      height?: number;
      sources?: string[];
    },
  ): void {
    if (this.state !== 'started') return;

    // 先按 toolCallId 查找，再按 name 查找
    let record: ToolRecord | null = null;
    let resolvedId = '';

    const byId = this.tools.get(identifier);
    if (byId) {
      record = byId;
      resolvedId = identifier;
    } else {
      // 按 name 模糊匹配
      for (const [id, r] of this.tools) {
        if (r.name === identifier) {
          record = r;
          resolvedId = id;
          break;
        }
      }
    }

    if (!record) return;

    const duration = Date.now() - record.startTime;
    this.tools.delete(resolvedId);

    this.track('tool_end', {
      toolCallId: resolvedId,
      toolName: record.name,
      toolSuccess: result.success,
      toolDuration: duration,
      resultCount: result.resultCount,
      error: result.error,
      imageUrl: result.imageUrl,
      imageWidth: result.width,
      imageHeight: result.height,
      sources: result.sources,
    });
  }

  // ===== 图片加载追踪 =====

  imageLoadStart(imageUrl: string): void {
    if (this.state !== 'started') return;
    this.imageLoads.set(imageUrl, Date.now());
    this.track('image_load_start', { imageUrl });
  }

  imageLoadEnd(imageUrl: string, result: { success: boolean; size?: number; error?: string }): void {
    if (this.state !== 'started') return;
    const startTime = this.imageLoads.get(imageUrl);
    if (startTime === undefined) return;

    const duration = Date.now() - startTime;
    this.imageLoads.delete(imageUrl);

    if (result.success) {
      this.track('image_load_complete', { imageUrl, duration, imageSize: result.size });
    } else {
      this.track('image_load_error', { imageUrl, duration, error: result.error });
    }
  }

  // ===== 私有方法 =====

  private track(type: SSETraceEventType, extra: Record<string, unknown> = {}): void {
    this.monitor.report({
      type: 'sse',
      timestamp: Date.now(),
      data: {
        traceId: this.traceId,
        aiMessageId: this.aiMessageId,
        sseType: type,
        ...extra,
      },
    });
  }

  private startStallDetection(): void {
    this.stopStallDetection();
    this.stallTimer = setTimeout(() => this.onStall(), this.stallThreshold);
  }

  private stopStallDetection(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private onStall(): void {
    if (this.state !== 'started') return;
    this.isStalled = true;
    this.track('sse_stall', {
      stallDuration: this.stallThreshold,
      lastChunkTime: this.lastChunkTime || undefined,
    });
    this.startStallDetection(); // 继续检测
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
  }
}

// ===== TracePlugin =====

export class TracePlugin extends ListenerPlugin {
  name = 'trace-plugin';
  version = '0.1.0';

  private currentTrace: Trace | null = null;

  onSetup(monitor: MonitorCore): void {
    // 将 Trace 能力注入 Monitor
    const self = this;
    const m = monitor as MonitorCore & Record<string, unknown>;

    m.createTrace = function (options?: TraceOptions): Trace {
      const trace = new Trace(monitor, options);
      self.currentTrace = trace;
      return trace;
    };

    m.setCurrentTrace = function (trace: Trace | null): void {
      self.currentTrace = trace;
    };

    m.getCurrentTrace = function (): Trace | null {
      return self.currentTrace;
    };
  }

  onDestroy(): void {
    this.currentTrace = null;
  }
}

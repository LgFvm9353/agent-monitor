/**
 * Monitor 主类 — SDK 入口
 *
 * 负责任务：
 * 1. 管理插件生命周期
 * 2. 接收事件并通过 Pipeline → Transport 上报
 * 3. 管理会话和面包屑上下文
 * 4. beforeSend 钩子 + 分类型采样 + debug 日志
 */
import type { MonitorConfig, MonitorEvent, Breadcrumb, EventMeta, SampleRateConfig } from '../types';
import type { MonitorPlugin, MonitorCore, CollectableEvent } from './types';
import { Pipeline } from './pipeline';
import { Transport } from './transport';

declare const SDK_VERSION: string;

let instanceId = 0;

export class Monitor implements MonitorCore {
  config: MonitorConfig;
  private plugins: MonitorPlugin[] = [];
  private pipeline: Pipeline;
  private transport: Transport;
  private sessionId: string;
  private breadcrumbs: Breadcrumb[] = [];
  private started = false;
  private collectTimer: ReturnType<typeof setInterval> | null = null;
  private beforeSend: ((event: MonitorEvent) => MonitorEvent | null) | null;
  private debug: boolean;

  constructor(config: MonitorConfig) {
    this.config = { enabled: true, sampleRate: 1, ...config };
    this.beforeSend = config.beforeSend ?? null;
    this.debug = config.debug ?? false;
    this.transport = new Transport(config.reportUrl, config.transport);
    this.pipeline = new Pipeline((events) => {
      for (const event of events) {
        this.transport.enqueue(event);
      }
    });
    this.sessionId = this.generateSessionId();
  }

  // ===== Plugin Management =====

  use(plugin: MonitorPlugin): void {
    this.plugins.push(plugin);
    if (this.started) {
      plugin.setup?.(this);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.config.enabled) {
      this.log('Monitor disabled via config');
      return;
    }
    if (!this.shouldSample('custom', this.config.sampleRate ?? 1)) {
      this.log('Monitor excluded by global sample rate');
      return;
    }

    this.started = true;
    this.log(`Monitor started (session: ${this.sessionId})`);

    for (const plugin of this.plugins) {
      await plugin.setup?.(this);
    }

    this.collectTimer = setInterval(async () => {
      await this.collect();
    }, 5000);
  }

  destroy(): void {
    this.started = false;
    if (this.collectTimer) clearInterval(this.collectTimer);
    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }
    this.transport.flush();
    this.transport.destroy();
    this.log('Monitor destroyed');
  }

  // ===== Event Reporting =====

  report(event: Omit<MonitorEvent, 'eventId' | 'meta'> & { meta?: Partial<EventMeta> }): void {
    // 分类型采样检查
    if (!this.shouldSample(event.type, this.config.sampleRate ?? 1)) return;

    const fullEvent = this.enrichEvent({
      eventId: this.generateEventId(),
      ...event,
      meta: {
        url: typeof window !== 'undefined' ? window.location.href : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        sessionId: this.sessionId,
        pageId: this.getPageId(),
        sdkVersion: SDK_VERSION,
        appId: this.config.appId || 'unknown',
        tags: { ...(this.config.appId ? { appId: this.config.appId } : {}) },
        ...event.meta,
      },
      data: { ...event.data, breadcrumbs: [...this.breadcrumbs] },
    } as MonitorEvent);

    // beforeSend 钩子：返回 null 则丢弃
    const processed = this.beforeSend ? this.beforeSend(fullEvent) : fullEvent;
    if (!processed) {
      this.log(`Event dropped by beforeSend: ${fullEvent.type}`);
      return;
    }

    this.pipeline.process([processed]);
  }

  // ===== Breadcrumb Management =====

  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    this.breadcrumbs.push({ ...breadcrumb, timestamp: Date.now() });
    if (this.breadcrumbs.length > 100) this.breadcrumbs.shift();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // ===== Internal Methods =====

  private async collect(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.collect) {
        try {
          const rawEvents = await plugin.collect();
          if (rawEvents.length > 0) {
            // 为 collect 产生的事件补充 eventId 和 meta
            const enriched = rawEvents
              .filter((e) => this.shouldSample(e.type, this.config.sampleRate ?? 1))
              .map((e) => this.enrichEvent(e));
            if (enriched.length > 0) {
              // beforeSend 过滤
              const processed = this.beforeSend
                ? enriched.map((e) => this.beforeSend!(e)).filter((e): e is MonitorEvent => e !== null)
                : enriched;
              if (processed.length > 0) {
                this.pipeline.process(processed);
              }
            }
          }
        } catch (err) {
          this.log(`Plugin ${plugin.name} collect error:`, err);
        }
      }
    }
  }

  /** 为插件产出的事件补充完整字段 */
  private enrichEvent(event: CollectableEvent): MonitorEvent {
    return {
      eventId: event.eventId || this.generateEventId(),
      type: event.type,
      timestamp: event.timestamp || Date.now(),
      data: event.data,
      meta: {
        url: typeof window !== 'undefined' ? window.location.href : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        sessionId: this.sessionId,
        pageId: this.getPageId(),
        sdkVersion: SDK_VERSION,
        appId: this.config.appId || 'unknown',
        tags: { ...(this.config.appId ? { appId: this.config.appId } : {}) },
        ...event.meta,
      },
    };
  }

  /** 分类型采样检查 */
  private shouldSample(eventType: string, sampleRate: number | SampleRateConfig): boolean {
    if (typeof sampleRate === 'number') {
      return Math.random() < sampleRate;
    }
    const rate = sampleRate[eventType as keyof SampleRateConfig] ?? 1;
    return Math.random() < rate;
  }

  private generateSessionId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateEventId(): string {
    instanceId++;
    return `${this.sessionId}-${instanceId}`;
  }

  private getPageId(): string {
    return typeof window !== 'undefined' ? window.location.pathname : '';
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[AgentHarnessMonitor]', ...args);
    }
  }
}

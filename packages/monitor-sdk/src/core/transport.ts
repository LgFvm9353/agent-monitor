/**
 * Transport 传输层 — 参考 sky-monitor-sdk 架构重写
 *
 * 核心改进：
 * 1. 优先级队列 — high/normal/low 三级，容量上限保护
 * 2. 多模式发送 — immediate（关键错误）/ throttle（高频事件）/ batch（批量）
 * 3. 写前日志 — 每个事件先写 IndexedDB，发送成功后清除
 * 4. 指数退避 + 随机抖动 — 避免重试风暴
 */

import type { MonitorEvent, TransportConfig } from '../types';

// ===== 默认配置 =====
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL = 5000;
const DEFAULT_THROTTLE_INTERVAL = 1000;
const DEFAULT_MAX_BUFFER = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY = 1000;
const DEFAULT_MAX_RETRY_DELAY = 30000;
const DEFAULT_RETRY_JITTER = 0.2;

/** 关键错误类型 — 默认立即发送（对齐 ErrorData.errorType） */
const DEFAULT_CRITICAL_TYPES = ['js', 'promise', 'resource'];

// ===== 类型 =====

type EventPriority = 'high' | 'normal' | 'low';
type SendMode = 'immediate' | 'throttle' | 'batch';

interface QueuedEvent {
  event: MonitorEvent;
  priority: EventPriority;
  retryCount: number;
}

// ===== PriorityQueue — 优先级队列 =====

class PriorityQueue {
  private high: QueuedEvent[] = [];
  private normal: QueuedEvent[] = [];
  private low: QueuedEvent[] = [];
  private maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_BUFFER) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.high.length + this.normal.length + this.low.length;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  /** 入队，超出容量时按优先级淘汰 */
  enqueue(event: MonitorEvent, priority: EventPriority): boolean {
    if (this.size >= this.maxSize) {
      // 1. 先丢弃 low
      if (this.low.length > 0) {
        this.low.shift();
      } else if (this.normal.length > 0 && priority !== 'high') {
        // 2. 丢弃 normal（仅当新事件不是 high 时）
        this.normal.shift();
      } else {
        return false; // 队列满且无法淘汰
      }
    }

    const entry: QueuedEvent = { event, priority, retryCount: 0 };
    switch (priority) {
      case 'high': this.high.push(entry); break;
      case 'normal': this.normal.push(entry); break;
      case 'low': this.low.push(entry); break;
    }
    return true;
  }

  /** 按优先级出队 */
  dequeue(count: number): QueuedEvent[] {
    const result: QueuedEvent[] = [];
    while (result.length < count && this.size > 0) {
      if (this.high.length > 0) result.push(this.high.shift()!);
      else if (this.normal.length > 0) result.push(this.normal.shift()!);
      else if (this.low.length > 0) result.push(this.low.shift()!);
    }
    return result;
  }

  /** 预览但不移除 */
  peek(count: number): QueuedEvent[] {
    const result: QueuedEvent[] = [];
    let remaining = count;
    let i = 0;
    while (i < remaining && i < this.high.length) result.push(this.high[i++]);
    remaining = count - result.length;
    i = 0;
    while (i < remaining && i < this.normal.length) result.push(this.normal[i++]);
    remaining = count - result.length;
    i = 0;
    while (i < remaining && i < this.low.length) result.push(this.low[i++]);
    return result;
  }

  /** 放回队列头部 */
  unshift(entries: QueuedEvent[]): void {
    for (const entry of [...entries].reverse()) {
      switch (entry.priority) {
        case 'high': this.high.unshift(entry); break;
        case 'normal': this.normal.unshift(entry); break;
        case 'low': this.low.unshift(entry); break;
      }
    }
  }

  /** 清空队列 */
  clear(): void {
    this.high = [];
    this.normal = [];
    this.low = [];
  }

  get stats(): { high: number; normal: number; low: number } {
    return {
      high: this.high.length,
      normal: this.normal.length,
      low: this.low.length,
    };
  }
}

// ===== RetryScheduler — 指数退避 + 抖动 =====

class RetryScheduler {
  private retryCount = 0;
  private baseDelay: number;
  private maxDelay: number;
  private jitter: number;
  private currentDelay: number;

  constructor(baseDelay: number, maxDelay: number, jitter: number) {
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.jitter = jitter;
    this.currentDelay = baseDelay;
  }

  /** 获取下次重试延迟（带抖动） */
  getNextDelay(): number {
    const delay = this.addJitter(this.currentDelay);
    this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
    this.retryCount++;
    return delay;
  }

  /** 成功时重置 */
  reset(): void {
    this.currentDelay = this.baseDelay;
    this.retryCount = 0;
  }

  /** 记录失败（不影响 retryCount） */
  recordFailure(): void {
    this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
    this.retryCount++;
  }

  get count(): number {
    return this.retryCount;
  }

  private addJitter(delay: number): number {
    const factor = 1 + (Math.random() * 2 - 1) * this.jitter;
    return Math.round(delay * factor);
  }
}

// ===== Transport =====

export class Transport {
  private reportUrl: string;
  private batchSize: number;
  private flushInterval: number;
  private throttleInterval: number;
  private maxRetries: number;
  private enableOffline: boolean;

  private defaultMode: SendMode;
  private typeConfig: Record<string, SendMode>;
  private criticalTypes: Set<string>;

  private queue: PriorityQueue;
  private throttleQueue: PriorityQueue;
  private retryScheduler: RetryScheduler;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private throttleTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private isRetrying = false;
  private lastThrottleSend = 0;
  private lastRetryTime = 0;

  // IndexedDB
  private offlineDB: IDBDatabase | null = null;
  private writeAheadEnabled = false;

  constructor(reportUrl: string, config?: TransportConfig) {
    this.reportUrl = reportUrl;
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushInterval = config?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.throttleInterval = config?.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.enableOffline = config?.enableOffline ?? true;

    this.defaultMode = config?.mode ?? 'batch';
    this.typeConfig = config?.typeConfig ?? {};
    this.criticalTypes = new Set(config?.criticalTypes ?? DEFAULT_CRITICAL_TYPES);

    // 关键类型默认走 immediate
    for (const type of this.criticalTypes) {
      if (!this.typeConfig[type]) {
        this.typeConfig[type] = 'immediate';
      }
    }

    const maxBuffer = config?.maxBufferSize ?? DEFAULT_MAX_BUFFER;
    this.queue = new PriorityQueue(maxBuffer);
    this.throttleQueue = new PriorityQueue(maxBuffer);

    this.retryScheduler = new RetryScheduler(
      config?.baseRetryDelay ?? DEFAULT_BASE_RETRY_DELAY,
      config?.maxRetryDelay ?? DEFAULT_MAX_RETRY_DELAY,
      config?.retryJitter ?? DEFAULT_RETRY_JITTER,
    );

    this.initWriteAheadLog();
    this.startTimers();
    this.setupUnloadHandler();
  }

  // ===== 公开接口 =====

  /** 将事件加入传输队列 */
  enqueue(event: MonitorEvent): void {
    const mode = this.getMode(event);
    const priority = this.getPriority(event);

    switch (mode) {
      case 'immediate':
        this.sendImmediate(event);
        break;
      case 'throttle':
        this.throttleQueue.enqueue(event, priority);
        break;
      case 'batch':
      default: {
        const ok = this.queue.enqueue(event, priority);
        if (!ok) {
          console.warn('[AgentHarnessMonitor] Buffer full, event dropped:', event.type);
        }
        // 写前日志：存到 IndexedDB
        this.writeAhead(event);
        // 达到批量大小立即刷出
        if (this.queue.size >= this.batchSize) {
          this.flush();
        }
        break;
      }
    }
  }

  /** 立即发送排队事件 */
  async flush(): Promise<void> {
    if (this.queue.isEmpty || this.isFlushing) return;
    this.isFlushing = true;

    try {
      const batch = this.queue.dequeue(this.batchSize);
      if (batch.length === 0) return;

      const events = batch.map((e) => e.event);
      const success = await this.send(events);

      if (success) {
        this.retryScheduler.reset();
        // 发送成功，从 IndexedDB 清除已发送事件
        this.clearSentFromOffline(events);
      } else {
        // 发送失败，放回队列重试
        for (const entry of batch) {
          entry.retryCount++;
          if (entry.retryCount < this.maxRetries) {
            this.queue.unshift([entry]);
          }
          // 超出重试次数，数据已在 IndexedDB 中，丢弃队列中的副本
        }
        this.scheduleRetry();
      }
    } catch {
      this.scheduleRetry();
    } finally {
      this.isFlushing = false;
    }
  }

  /** 节流刷出 */
  private throttleFlush(): void {
    const now = Date.now();
    if (now - this.lastThrottleSend < this.throttleInterval) return;
    this.lastThrottleSend = now;

    if (!this.throttleQueue.isEmpty) {
      const batch = this.throttleQueue.dequeue(this.batchSize);
      const events = batch.map((e) => e.event);
      this.send(events).catch(() => {
        // 失败放回节流队列
        this.throttleQueue.unshift(batch);
      });
    }
    // 同时刷批量队列
    this.flush();
  }

  /** 销毁 Transport */
  destroy(): void {
    this.stopTimers();
    // 最后用 sendBeacon 清空队列
    this.flushBeacon();
  }

  // ===== 私有方法：发送 =====

  private async send(events: MonitorEvent[]): Promise<boolean> {
    try {
      const response = await fetch(this.reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
        keepalive: true,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** 立即发送（用于关键错误），失败回退到批量队列 */
  private async sendImmediate(event: MonitorEvent): Promise<void> {
    // 同时也写前日志
    this.writeAhead(event);

    const success = await this.send([event]);
    if (!success) {
      // 回退：作为高优先级加入批量队列
      this.queue.enqueue(event, 'high');
      this.scheduleRetry();
    } else {
      this.clearSentFromOffline([event]);
    }
  }

  /** 通过 sendBeacon 发送（页面卸载时） */
  private sendBeacon(events: MonitorEvent[]): boolean {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
    try {
      const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });
      return navigator.sendBeacon(this.reportUrl, blob);
    } catch {
      return false;
    }
  }

  /** 页面卸载时清空所有队列 */
  private flushBeacon(): void {
    const allBatch = this.queue.dequeue(this.queue.size);
    const allThrottle = this.throttleQueue.dequeue(this.throttleQueue.size);
    const all = [...allBatch, ...allThrottle];

    if (all.length === 0) return;

    const events = all.map((e) => e.event);
    if (!this.sendBeacon(events)) {
      // sendBeacon 失败，放回队列（数据在 IndexedDB 中有备份）
      this.queue.unshift(allBatch);
      this.throttleQueue.unshift(allThrottle);
    }
  }

  // ===== 私有方法：辅助 =====

  private getMode(event: MonitorEvent): SendMode {
    // 从 event.data 中提取 errorType 用于匹配
    const errorType =
      event.type === 'error' && event.data && typeof event.data === 'object'
        ? (event.data as unknown as Record<string, unknown>).errorType as string
        : undefined;

    // 用 errorType 匹配（如 'js_error'）
    if (errorType && this.typeConfig[errorType]) {
      return this.typeConfig[errorType];
    }
    // 用 event.type 匹配（如 'error'）
    return this.typeConfig[event.type] ?? this.defaultMode;
  }

  private getPriority(event: MonitorEvent): EventPriority {
    // 关键错误 → high
    if (event.type === 'error' && event.data && typeof event.data === 'object') {
      const errorType = (event.data as unknown as Record<string, unknown>).errorType as string;
      if (errorType && this.criticalTypes.has(errorType)) return 'high';
    }
    return 'normal';
  }

  // ===== 私有方法：定时器 =====

  private startTimers(): void {
    // 批量刷出定时器
    this.flushTimer = setInterval(() => {
      if (!this.queue.isEmpty && !this.isFlushing) {
        this.flush();
      }
    }, this.flushInterval);

    // 节流刷出定时器
    this.throttleTimer = setInterval(() => {
      this.throttleFlush();
    }, this.throttleInterval);
  }

  private stopTimers(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setupUnloadHandler(): void {
    if (typeof window === 'undefined') return;

    // pagehide: 比 beforeunload 更可靠（包括移动端）
    const handler = (event: Event) => {
      // PageTransitionEvent.persisted: true 表示页面被缓存（bfcache），不需要 flush
      if (event instanceof PageTransitionEvent && event.persisted) return;
      this.flushBeacon();
    };
    window.addEventListener('pagehide', handler);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushBeacon();
      }
    });
  }

  // ===== 私有方法：重试 =====

  private scheduleRetry(): void {
    if (this.isRetrying || this.retryTimer) return;

    // 防止频繁重试（30秒内最多触发一次重试调度）
    const now = Date.now();
    if (now - this.lastRetryTime < 30000) return;
    this.lastRetryTime = now;

    const delay = this.retryScheduler.getNextDelay();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.isRetrying = true;
      this.flush().finally(() => {
        this.isRetrying = false;
      });
    }, delay);
  }

  // ===== 私有方法：写前日志（IndexedDB） =====

  private initWriteAheadLog(): void {
    if (!this.enableOffline || typeof indexedDB === 'undefined') return;

    const request = indexedDB.open('AgentHarnessMonitor', 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('offlineEvents')) {
        db.createObjectStore('offlineEvents', { keyPath: 'eventId' });
      }
    };
    request.onsuccess = (event) => {
      this.offlineDB = (event.target as IDBOpenDBRequest).result;
      this.writeAheadEnabled = true;
      // 恢复离线缓存的旧事件
      this.recoverOfflineEvents();
    };
  }

  /** 写前日志：每个事件先存 IndexedDB */
  private writeAhead(event: MonitorEvent): void {
    if (!this.writeAheadEnabled || !this.offlineDB) return;

    try {
      const tx = this.offlineDB.transaction('offlineEvents', 'readwrite');
      const store = tx.objectStore('offlineEvents');
      store.put(event);
    } catch {
      // IndexedDB 写入失败不影响主流程
    }
  }

  /** 发送成功后从 IndexedDB 清除 */
  private clearSentFromOffline(events: MonitorEvent[]): void {
    if (!this.writeAheadEnabled || !this.offlineDB) return;

    try {
      const tx = this.offlineDB.transaction('offlineEvents', 'readwrite');
      const store = tx.objectStore('offlineEvents');
      for (const event of events) {
        store.delete(event.eventId);
      }
    } catch {
      // 清除失败不影响
    }
  }

  /** 恢复离线事件 */
  private async recoverOfflineEvents(): Promise<void> {
    if (!this.offlineDB) return;

    try {
      const tx = this.offlineDB.transaction('offlineEvents', 'readonly');
      const store = tx.objectStore('offlineEvents');
      const request = store.getAll();

      request.onsuccess = async () => {
        const events = request.result as MonitorEvent[];
        if (events.length === 0) return;

        const success = await this.send(events);
        if (success) {
          // 恢复成功，清除离线缓存
          const deleteTx = this.offlineDB!.transaction('offlineEvents', 'readwrite');
          const deleteStore = deleteTx.objectStore('offlineEvents');
          for (const event of events) {
            deleteStore.delete(event.eventId);
          }
        } else {
          // 恢复失败，事件保留在 IndexedDB，等待下次恢复
          // 同时放入批量队列尝试发送
          for (const event of events) {
            this.queue.enqueue(event, 'normal');
          }
        }
      };
    } catch {
      // 恢复失败不影响
    }
  }
}

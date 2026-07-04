/**
 * Pipeline — 上报管道
 *
 * 采用中间件链式处理模式（类似 Koa/Express 洋葱模型）：
 * 数据 → normalize → filter → dedup → transform → transport
 */
import type { MonitorEvent } from '../types';
import type { PipelineMiddleware } from './types';

export class Pipeline {
  private middlewares: PipelineMiddleware[] = [];
  private onFlush: (events: MonitorEvent[]) => void;

  constructor(onFlush: (events: MonitorEvent[]) => void) {
    this.onFlush = onFlush;
    this.use(this.normalizeMiddleware());
    this.use(this.dedupMiddleware());
  }

  use(middleware: PipelineMiddleware): void {
    this.middlewares.push(middleware);
  }

  async process(events: MonitorEvent[]): Promise<void> {
    if (events.length === 0) return;
    const runner = this.compose(this.middlewares);
    const processed = await runner(events);
    this.onFlush(processed);
  }

  private compose(middlewares: PipelineMiddleware[]) {
    return (initial: MonitorEvent[]): Promise<MonitorEvent[]> => {
      let index = -1;
      const dispatch = (i: number, events: MonitorEvent[]): Promise<MonitorEvent[]> => {
        if (i <= index) return Promise.reject(new Error('next() called multiple times'));
        index = i;
        if (i >= middlewares.length) return Promise.resolve(events);
        return middlewares[i](events, (nextEvents) => dispatch(i + 1, nextEvents));
      };
      return dispatch(0, initial);
    };
  }

  // ===== 内置中间件 =====

  private normalizeMiddleware(): PipelineMiddleware {
    return async (events, next) => {
      const normalized = events.map((event) => ({
        ...event,
        timestamp: event.timestamp || Date.now(),
        meta: {
          url: event.meta?.url || (typeof window !== 'undefined' ? window.location.href : ''),
          userAgent: event.meta?.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
          sessionId: event.meta?.sessionId || '',
          pageId: event.meta?.pageId || '',
          sdkVersion: event.meta?.sdkVersion || '0.1.0',
          appId: event.meta?.appId || 'unknown',
          tags: event.meta?.tags || {},
        },
      }));
      return next(normalized);
    };
  }

  private dedupMiddleware(): PipelineMiddleware {
    const errorMap = new Map<string, { count: number }>();
    return async (events, next) => {
      const deduped: MonitorEvent[] = [];
      for (const event of events) {
        if (event.type === 'error') {
          const data = event.data as { errorId?: string };
          const errorId = data.errorId;
          if (errorId) {
            const existing = errorMap.get(errorId);
            if (existing) {
              existing.count++;
              continue; // 跳过重复错误
            }
            errorMap.set(errorId, { count: 1 });
          }
        }
        deduped.push(event);
      }
      return next(deduped);
    };
  }
}

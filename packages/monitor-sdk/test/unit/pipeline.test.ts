/**
 * Pipeline 单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import type { MonitorEvent } from '../../src/types';
import { Pipeline } from '../../src/core/pipeline';
import type { PipelineMiddleware } from '../../src/core/types';

/** 生成最小化的测试用 MonitorEvent */
function makeEvent(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    eventId: 'evt-1',
    type: 'custom',
    timestamp: Date.now(),
    data: {},
    meta: {
      url: 'http://test.com',
      userAgent: 'vitest',
      sessionId: 'sess-1',
      pageId: '/test',
      sdkVersion: '0.1.0',
    },
    ...overrides,
  } as MonitorEvent;
}

describe('Pipeline', () => {
  it('应通过内置中间件处理事件并调用 onFlush', async () => {
    const onFlush = vi.fn();
    const pipeline = new Pipeline(onFlush);
    const event = makeEvent();

    await pipeline.process([event]);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const flushed = onFlush.mock.calls[0][0] as MonitorEvent[];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].meta.url).toBe('http://test.com');
  });

  it('空事件数组不应触发 onFlush', async () => {
    const onFlush = vi.fn();
    const pipeline = new Pipeline(onFlush);

    await pipeline.process([]);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('应支持自定义中间件', async () => {
    const onFlush = vi.fn();
    const pipeline = new Pipeline(onFlush);

    // 添加一个加 tags 的中间件
    const tagMiddleware: PipelineMiddleware = async (events, next) => {
      const tagged = events.map((e) => ({
        ...e,
        meta: { ...e.meta, tags: { ...e.meta.tags, processed: 'true' } },
      }));
      return next(tagged);
    };
    pipeline.use(tagMiddleware);

    const event = makeEvent();
    await pipeline.process([event]);

    const flushed = onFlush.mock.calls[0][0] as MonitorEvent[];
    expect(flushed[0].meta.tags).toEqual({ processed: 'true' });
  });

  it('中间件可以修改事件数量', async () => {
    const onFlush = vi.fn();
    const pipeline = new Pipeline(onFlush);

    // 过滤中间件：只保留 error 类型
    const filterMiddleware: PipelineMiddleware = async (events, next) => {
      return next(events.filter((e) => e.type === 'error'));
    };
    pipeline.use(filterMiddleware);

    await pipeline.process([
      makeEvent({ type: 'error', data: { errorType: 'js', message: 'err', errorId: 'err_1' } }),
      makeEvent({ type: 'custom' }),
    ]);

    const flushed = onFlush.mock.calls[0][0] as MonitorEvent[];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].type).toBe('error');
  });

  it('多个中间件应按洋葱模型顺序执行', async () => {
    const order: string[] = [];
    const onFlush = vi.fn();

    const pipeline = new Pipeline(onFlush);

    const mw1: PipelineMiddleware = async (events, next) => {
      order.push('mw1-enter');
      const result = await next(events);
      order.push('mw1-exit');
      return result;
    };
    const mw2: PipelineMiddleware = async (events, next) => {
      order.push('mw2-enter');
      const result = await next(events);
      order.push('mw2-exit');
      return result;
    };

    // 内置中间件已经有两个（normalize + dedup），我们再添加两个
    pipeline.use(mw1);
    pipeline.use(mw2);

    await pipeline.process([makeEvent()]);

    // 洋葱模型：mw1-enter → mw2-enter → [builtins] → mw2-exit → mw1-exit
    expect(order[0]).toBe('mw1-enter');
    expect(order[1]).toBe('mw2-enter');
    expect(order[order.length - 2]).toBe('mw2-exit');
    expect(order[order.length - 1]).toBe('mw1-exit');
  });

  it('dedup 中间件应去重相同 errorId 的错误', async () => {
    const onFlush = vi.fn();
    const pipeline = new Pipeline(onFlush);

    await pipeline.process([
      makeEvent({ type: 'error', data: { errorType: 'js', message: 'boom', errorId: 'err_123' } }),
      makeEvent({ type: 'error', data: { errorType: 'js', message: 'boom', errorId: 'err_123' } }),
      makeEvent({ type: 'error', data: { errorType: 'js', message: 'other', errorId: 'err_456' } }),
    ]);

    const flushed = onFlush.mock.calls[0][0] as MonitorEvent[];
    expect(flushed).toHaveLength(2);
    expect(flushed[0].data).toMatchObject({ errorId: 'err_123' });
    expect(flushed[1].data).toMatchObject({ errorId: 'err_456' });
  });
});

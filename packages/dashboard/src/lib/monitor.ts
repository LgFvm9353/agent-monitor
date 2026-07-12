/**
 * Dashboard 监控单例
 *
 * 统一提供：
 * 1. Dashboard 自监控（错误 / 性能 / 行为）
 * 2. Agent Playground 的 SSE Trace / Runtime Event 上报
 */
import type { MonitorEvent } from '@agenteye/monitor-sdk';
import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin, TracePlugin } from '@agenteye/monitor-sdk';

function shouldDropSelfReportingEvent(event: MonitorEvent): boolean {
  if (event.type !== 'behavior') {
    return false;
  }

  const data = event.data;
  if (!data || typeof data !== 'object') {
    return false;
  }

  const behavior = data as { behaviorType?: string; url?: string };
  if (behavior.behaviorType !== 'http' || typeof behavior.url !== 'string') {
    return false;
  }

  return behavior.url.includes('/api/monitor/report');
}

export const monitor = new Monitor({
  reportUrl: '/api/monitor/report',
  appId: 'dashboard-self',
  beforeSend: (event) => {
    if (shouldDropSelfReportingEvent(event)) {
      return null;
    }
    return event;
  },
  sampleRate: {
    error: 1,
    performance: 1,
    behavior: 0.3,
    custom: 1,
    sse: 1,
    runtime: 1,
  },
});

monitor.use(new ErrorPlugin());
monitor.use(new PerformancePlugin());
monitor.use(new BehaviorPlugin());
monitor.use(new TracePlugin());

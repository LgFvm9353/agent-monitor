/**
 * @agenteye/monitor-sdk
 *
 * 前端监控 SDK —— AI Agent Harness Monitor 的前端可观测性组件
 *
 * 提供：
 * - 错误追踪 (JS Error / Promise Rejection / Resource Error)
 * - 性能监控 (Core Web Vitals / Navigation Timing)
 * - 用户行为采集 (Clicks / Routes / HTTP Requests)
 * - 插件化架构，支持自定义扩展
 *
 * @example
 * ```ts
 * import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin } from '@agenteye/monitor-sdk';
 *
 * const monitor = new Monitor({
 *   reportUrl: 'https://api.example.com/monitor',
 *   appId: 'my-app',
 * });
 *
 * monitor.use(new ErrorPlugin());
 * monitor.use(new PerformancePlugin());
 * monitor.use(new BehaviorPlugin());
 *
 * monitor.start();
 * ```
 */

// 核心类
export { Monitor } from './core/monitor';
export { Pipeline } from './core/pipeline';
export { Transport } from './core/transport';
export { BasePlugin, CollectorPlugin, ListenerPlugin } from './core/plugin';

// 插件
export { ErrorPlugin } from './plugins/error';
export { PerformancePlugin } from './plugins/performance';
export { BehaviorPlugin } from './plugins/behavior';
export { CustomPlugin } from './plugins/custom';
export { TracePlugin, Trace } from './plugins/trace';

// 工具函数
export { generateErrorId } from './utils/error-id';
export { parseStackTrace, formatStackTrace } from './utils/stack-parser';
export { WhiteScreenDetector } from './utils/white-screen';

// 类型导出
export type { MonitorPlugin, MonitorCore, PipelineMiddleware, CollectableEvent } from './core/types';
export type {
  MonitorConfig,
  MonitorEvent,
  EventMeta,
  ErrorData,
  ErrorCategory,
  PerformanceData,
  PerfCategory,
  BehaviorData,
  BehaviorCategory,
  CustomData,
  Breadcrumb,
  TraceData,
  TraceOptions,
  SSETraceEventType,
  RuntimeData,
  RuntimeEventKind,
  RuntimeEventStatus,
  TransportConfig,
  SampleRateConfig,
} from './types';
export type { StackFrame } from './utils/stack-parser';
export type { WhiteScreenConfig } from './utils/white-screen';

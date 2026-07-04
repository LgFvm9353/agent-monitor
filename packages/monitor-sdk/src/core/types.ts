/**
 * Monitor SDK 核心类型（内部使用）
 */
import type {
  MonitorConfig,
  MonitorEvent,
  Breadcrumb,
  EventMeta,
} from '../types';

/** 插件 collect() 返回的轻量事件 — eventId 和 meta 由 Monitor 自动填充 */
export type CollectableEvent = Omit<MonitorEvent, 'eventId' | 'meta'> & {
  eventId?: string;
  meta?: Partial<EventMeta>;
};

/** 插件生命周期钩子 */
export interface MonitorPlugin {
  name: string;
  version: string;
  /** 插件初始化 */
  setup?: (monitor: MonitorCore) => void | Promise<void>;
  /** 收集数据（主动采集型插件），返回的事件由 Monitor 统一补充 eventId/meta */
  collect?: () => CollectableEvent[] | Promise<CollectableEvent[]>;
  /** 销毁插件 */
  destroy?: () => void;
}

/** 上报管道中的中间件 — 洋葱模型，通过 next(events) 将处理后的事件传递给下一层 */
export type PipelineMiddleware = (
  events: MonitorEvent[],
  next: (events: MonitorEvent[]) => Promise<MonitorEvent[]>,
) => Promise<MonitorEvent[]>;

/** Monitor 核心上下文 */
export interface MonitorCore {
  config: MonitorConfig;
  /** 手动上报事件 */
  report: (event: Omit<MonitorEvent, 'eventId' | 'meta'> & { meta?: Partial<EventMeta> }) => void;
  /** 添加面包屑 */
  addBreadcrumb: (breadcrumb: Omit<Breadcrumb, 'timestamp'>) => void;
  /** 获取会话ID */
  getSessionId: () => string;
  /** 注册插件 */
  use: (plugin: MonitorPlugin) => void;
  /** 创建 SSE Trace 实例（由 TracePlugin 注入） */
  createTrace?: (options?: import('../types').TraceOptions) => import('../plugins/trace').Trace;
  /** 设置当前 Trace */
  setCurrentTrace?: (trace: import('../plugins/trace').Trace | null) => void;
  /** 获取当前 Trace */
  getCurrentTrace?: () => import('../plugins/trace').Trace | null;
}

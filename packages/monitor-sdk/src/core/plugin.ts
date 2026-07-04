/**
 * Plugin 基类 — 所有插件的抽象基类
 *
 * 插件生命周期：
 *   setup → collect (looping) → destroy
 *
 * 每个插件专注一种数据采集类型：
 *   ErrorPlugin    → JS Error / Promise Rejection / Resource Error
 *   PerformancePlugin → Web Vitals / Navigation Timing
 *   BehaviorPlugin → Clicks / Routes / HTTP Requests
 *   CustomPlugin   → 用户自定义事件
 */

import type { MonitorPlugin, MonitorCore, CollectableEvent } from './types';

export abstract class BasePlugin implements MonitorPlugin {
  abstract name: string;
  abstract version: string;
  protected monitor: MonitorCore | null = null;

  setup(monitor: MonitorCore): void {
    this.monitor = monitor;
    this.onSetup(monitor);
  }

  destroy(): void {
    this.onDestroy();
    this.monitor = null;
  }

  abstract onSetup(monitor: MonitorCore): void;
  abstract onDestroy(): void;
}

/** 主动采集型插件基类（性能、行为类） */
export abstract class CollectorPlugin extends BasePlugin {
  abstract collect(): CollectableEvent[] | Promise<CollectableEvent[]>;
}

/** 被动监听型插件基类（错误类） */
export abstract class ListenerPlugin extends BasePlugin {
  // 插件通过 setup 注册事件监听器
  // 事件触发时通过 this.monitor.report() 立即上报
}

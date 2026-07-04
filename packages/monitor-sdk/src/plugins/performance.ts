/**
 * PerformancePlugin — 性能监控插件
 *
 * 采集指标：
 * 1. Core Web Vitals (LCP, FCP, INP, CLS, TTFB)
 * 2. Navigation Timing (DNS, TCP, Request, DOM Parse)
 * 3. Long Task 监控
 *
 * 设计：Observer 回调仅存储指标，由 collect() 统一产出事件。
 * 避免每条指标立即上报造成的重复和碎片化。
 */

import type { PerformanceData } from '../types';
import { CollectorPlugin } from '../core/plugin';
import type { MonitorCore, CollectableEvent } from '../core/types';

export class PerformancePlugin extends CollectorPlugin {
  name = 'performance-plugin';
  version = '0.1.0';

  /** 存储 Web Vitals 观测值 */
  private webVitals: Partial<PerformanceData> = {};
  /** 存储 Long Task 数据 */
  private longTaskDurations: number[] = [];
  /** 标记 Navigation Timing 是否已采集（只需采一次） */
  private navTimingCollected = false;
  /** 存储 CLS 累计值引用 */
  private clsValue = 0;

  onSetup(_monitor: MonitorCore): void {
    this.observeWebVitals();
    this.observeLongTasks();
  }

  onDestroy(): void {
    this.webVitals = {};
    this.longTaskDurations = [];
    this.clsValue = 0;
  }

  /** 定期采集 — 合并 Web Vitals + Navigation Timing + Long Tasks 为一次上报 */
  collect(): CollectableEvent[] {
    const events: CollectableEvent[] = [];

    // 首次 collect 时抓取 Navigation Timing
    if (!this.navTimingCollected) {
      const navTiming = this.collectNavigationTiming();
      if (navTiming) {
        this.navTimingCollected = true;
        Object.assign(this.webVitals, navTiming);
      }
    }

    // 汇总 Web Vitals
    if (Object.keys(this.webVitals).length > 0) {
      events.push({
        type: 'performance',
        timestamp: Date.now(),
        data: { perfType: 'web-vital', ...this.webVitals } as PerformanceData,
      });
      // 重置 Web Vitals（CLS 只在页面隐藏时上报，不重置）
      const cls = this.webVitals.cls;
      this.webVitals = {};
      if (cls !== undefined) this.webVitals.cls = cls;
    }

    // 汇总 Long Tasks
    if (this.longTaskDurations.length > 0) {
      const count = this.longTaskDurations.length;
      const avg = this.longTaskDurations.reduce((a, b) => a + b, 0) / count;
      const max = Math.max(...this.longTaskDurations);
      events.push({
        type: 'performance',
        timestamp: Date.now(),
        data: {
          perfType: 'long-task',
          customMetrics: {
            longTaskCount: count,
            longTaskAvg: Math.round(avg),
            longTaskMax: Math.round(max),
          },
        } as PerformanceData,
      });
      this.longTaskDurations = [];
    }

    return events;
  }

  // ===== Web Vitals 观测 =====

  private observeWebVitals(): void {
    this.observeLCP();
    this.observeFCP();
    this.observeCLS();
    this.observeINP();
    this.observeTTFB();
  }

  private observeLCP(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
        if (lastEntry) {
          this.webVitals.lcp = lastEntry.startTime;
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* 浏览器不支持 */ }
  }

  private observeFCP(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntriesByName('first-contentful-paint');
        if (entries.length > 0) {
          this.webVitals.fcp = entries[0].startTime;
        }
      });
      observer.observe({ type: 'paint', buffered: true });
    } catch { /* 浏览器不支持 */ }
  }

  private observeCLS(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number })[]) {
          if (!entry.hadRecentInput) {
            this.clsValue += entry.value;
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });

      // CLS 在页面生命周期内累计，页面隐藏时上报最终值
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.webVitals.cls = this.clsValue;
        }
      });
    } catch { /* 浏览器不支持 */ }
  }

  private observeINP(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { duration: number })[]) {
          this.webVitals.inp = entry.duration;
        }
      });
      observer.observe({ type: 'first-input', buffered: true });
    } catch { /* 浏览器不支持 */ }
  }

  private observeTTFB(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries() as PerformanceNavigationTiming[];
        for (const entry of entries) {
          this.webVitals.ttfb = entry.responseStart - entry.requestStart;
        }
      });
      observer.observe({ type: 'navigation', buffered: true });
    } catch { /* fallback 到 Navigation Timing */ }
  }

  // ===== Long Task 观测 =====

  private observeLongTasks(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskDurations.push(entry.duration);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch { /* 浏览器不支持 */ }
  }

  // ===== Navigation Timing =====

  private collectNavigationTiming(): Partial<PerformanceData> | null {
    const timing = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!timing) return null;

    return {
      perfType: 'navigation',
      dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
      tcpTime: timing.connectEnd - timing.connectStart,
      requestTime: timing.responseStart - timing.requestStart,
      responseTime: timing.responseEnd - timing.responseStart,
      domParseTime: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
      domReadyTime: timing.domContentLoadedEventEnd - timing.fetchStart,
      loadTime: timing.loadEventEnd - timing.fetchStart,
    };
  }
}

/**
 * BehaviorPlugin — 用户行为追踪插件
 *
 * 采集：
 * 1. 点击事件面包屑
 * 2. SPA 路由变化 (hash + history)
 * 3. HTTP 请求监控 (Fetch + XHR 拦截，慢请求/错误)
 * 4. PV/UV 统计
 */

import type { BehaviorData, Breadcrumb } from '../types';
import { CollectorPlugin } from '../core/plugin';
import type { MonitorCore, CollectableEvent } from '../core/types';

export class BehaviorPlugin extends CollectorPlugin {
  name = 'behavior-plugin';
  version = '0.1.0';

  private pvReported = false;
  private clickBuffer: BehaviorData[] = [];
  private routeBuffer: BehaviorData[] = [];
  private httpBuffer: BehaviorData[] = [];

  onSetup(monitor: MonitorCore): void {
    this.captureClicks(monitor);
    this.captureRoutes(monitor);
    this.interceptFetch(monitor);
    this.interceptXHR(monitor);
    this.reportPV(monitor);
  }

  onDestroy(): void {
    this.clickBuffer = [];
    this.routeBuffer = [];
    this.httpBuffer = [];
  }

  collect(): CollectableEvent[] {
    const allData = [...this.clickBuffer, ...this.routeBuffer, ...this.httpBuffer];
    this.clickBuffer = [];
    this.routeBuffer = [];
    this.httpBuffer = [];

    if (allData.length === 0) return [];

    return allData.map((data) => ({
      type: 'behavior' as const,
      timestamp: Date.now(),
      data,
    }));
  }

  /** 点击事件追踪 */
  private captureClicks(monitor: MonitorCore): void {
    document.addEventListener(
      'click',
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target?.tagName) return;

        const data: BehaviorData = {
          behaviorType: 'click',
          tagName: target.tagName.toLowerCase(),
          className: typeof target.className === 'string' ? target.className : '',
          textContent: target.textContent?.substring(0, 100) ?? '',
          xpath: this.getXPath(target),
        };
        this.clickBuffer.push(data);

        // 同时添加面包屑
        monitor.addBreadcrumb({
          type: 'click',
          message: `Click: ${data.tagName}${data.className ? '.' + data.className : ''}`,
          data: { xpath: data.xpath },
        });
      },
      true,
    );
  }

  /** SPA 路由变化追踪 */
  private captureRoutes(monitor: MonitorCore): void {
    const trackRoute = (from: string, to: string) => {
      this.routeBuffer.push({ behaviorType: 'route', from, to });
      monitor.addBreadcrumb({
        type: 'route',
        message: `Route: ${from} → ${to}`,
        data: { from, to },
      });
    };

    let currentPath = window.location.href;

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (data: unknown, _unused: string, url?: string | URL | null): void {
      const newPath = url != null ? String(url) : '';
      originalPushState(data, _unused, url ?? null);
      if (newPath && newPath !== currentPath) {
        trackRoute(currentPath, newPath);
        currentPath = newPath;
      }
    };

    history.replaceState = function (data: unknown, _unused: string, url?: string | URL | null): void {
      const newPath = url != null ? String(url) : '';
      originalReplaceState(data, _unused, url ?? null);
      if (newPath && newPath !== currentPath) {
        trackRoute(currentPath, newPath);
        currentPath = newPath;
      }
    };

    window.addEventListener('popstate', () => {
      const newPath = window.location.href;
      if (newPath !== currentPath) {
        trackRoute(currentPath, newPath);
        currentPath = newPath;
      }
    });

    window.addEventListener('hashchange', () => {
      trackRoute(currentPath, window.location.href);
      currentPath = window.location.href;
    });
  }

  /** 拦截 Fetch 请求 */
  private interceptFetch(monitor: MonitorCore): void {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const startTime = performance.now();
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url
        : input.toString();
      const method = init?.method ?? 'GET';

      try {
        const response = await originalFetch(input, init);
        const duration = performance.now() - startTime;
        monitorSlowOrErrorRequest(url, method, response.status, duration, monitor);
        return response;
      } catch (error) {
        const duration = performance.now() - startTime;
        monitor.addBreadcrumb({
          type: 'http',
          message: `[Error] ${method} ${url} (${duration.toFixed(0)}ms)`,
          data: { method, url, error: String(error), duration },
        });
        throw error;
      }
    };
  }

  /** 拦截 XMLHttpRequest */
  private interceptXHR(monitor: MonitorCore): void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { _monitor_data?: Record<string, unknown> },
      method: string,
      url: string | URL,
      asyncFlag?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      this._monitor_data = { method, url: url.toString(), startTime: performance.now() };
      return originalOpen.call(this, method, url, asyncFlag ?? true, username ?? undefined, password ?? undefined);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
      const xhr = this as XMLHttpRequest & { _monitor_data?: Record<string, unknown> };
      const data = xhr._monitor_data;

      xhr.addEventListener('loadend', () => {
        if (!data) return;
        const duration = performance.now() - (data.startTime as number);
        monitorSlowOrErrorRequest(
          data.url as string,
          data.method as string,
          xhr.status,
          duration,
          monitor,
        );
      });

      return originalSend.call(this, body);
    };
  }

  /** PV 上报 */
  private reportPV(monitor: MonitorCore): void {
    if (this.pvReported) return;
    this.pvReported = true;
    // PV 使用立即上报（通过 monitor.report），不走 collect buffer
    monitor.report({
      type: 'behavior',
      timestamp: Date.now(),
      data: {
        behaviorType: 'route',
        from: '',
        to: window.location.href,
      },
    });
  }

  /** 获取元素的 XPath */
  private getXPath(element: HTMLElement): string {
    if (element === document.body) return '/html/body';
    if (element.id) return `//*[@id="${element.id}"]`;

    const parts: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `//*[@id="${current.id}"]`;
        parts.unshift(selector);
        break;
      }
      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        const siblings: Element[] = [];
        for (let k = 0; k < parent.children.length; k++) {
          if (parent.children[k].tagName === current.tagName) {
            siblings.push(parent.children[k]);
          }
        }
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `[${index}]`;
        }
      }
      parts.unshift(selector);
      current = parent;
    }
    return '/' + parts.join('/');
  }
}

/**
 * 监控慢请求（>1000ms）和错误请求（status >= 400）
 * 将数据同时写入面包屑和行为 Buffer
 */
function monitorSlowOrErrorRequest(
  url: string,
  method: string,
  status: number,
  duration: number,
  monitor: MonitorCore,
): void {
  const isSlow = duration > 1000;
  const isError = status >= 400;

  if (!isSlow && !isError) return;

  monitor.addBreadcrumb({
    type: 'http',
    message: `${method} ${url} → ${status} (${duration.toFixed(0)}ms)`,
    data: { method, url, status, duration },
  });

  // 通过 monitor.report 上报 HTTP 行为事件（不在 collect buffer 中，
  // 而是直接通过 report + breadcrumb 附带上下文信息）
  monitor.report({
    type: 'behavior',
    timestamp: Date.now(),
    data: {
      behaviorType: 'http',
      method,
      url: url.length > 500 ? url.substring(0, 500) : url,
      status,
      duration: Math.round(duration),
    },
  });
}

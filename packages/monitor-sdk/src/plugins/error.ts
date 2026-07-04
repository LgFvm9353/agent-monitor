/**
 * ErrorPlugin — 错误追踪插件
 *
 * 捕获四类错误：
 * 1. JS 运行时错误 (window.onerror)
 * 2. Promise 未处理拒绝 (unhandledrejection)
 * 3. 静态资源加载失败 (error event on window)
 * 4. console.error 劫持
 *
 * 错误去重：基于堆栈签名生成唯一 errorId
 */

import type { ErrorData, ErrorCategory } from '../types';
import { ListenerPlugin } from '../core/plugin';
import type { MonitorCore } from '../core/types';
import { generateErrorId } from '../utils/error-id';

export class ErrorPlugin extends ListenerPlugin {
  name = 'error-plugin';
  version = '0.1.0';

  private originalConsoleError: typeof console.error | null = null;

  onSetup(monitor: MonitorCore): void {
    this.captureJSErrors(monitor);
    this.capturePromiseRejections(monitor);
    this.captureResourceErrors(monitor);
    this.hijackConsoleError(monitor);
  }

  onDestroy(): void {
    // 恢复 console.error
    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }
  }

  /** 捕获 JS 运行时错误 */
  private captureJSErrors(monitor: MonitorCore): void {
    window.addEventListener('error', (event: ErrorEvent) => {
      if (!event.error && event.target instanceof Element) return; // 跳过资源错误

      const errorData = this.buildErrorData(event, 'js');
      monitor.report({
        type: 'error',
        timestamp: Date.now(),
        data: errorData,
      });
    });
  }

  /** 捕获 Promise 未处理拒绝 */
  private capturePromiseRejections(monitor: MonitorCore): void {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorData: ErrorData = {
        errorType: 'promise',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        errorId: generateErrorId(reason instanceof Error && reason.stack ? reason.stack : 'promise:' + String(reason)),
      };
      monitor.report({
        type: 'error',
        timestamp: Date.now(),
        data: errorData,
      });
    });
  }

  /** 捕获静态资源加载失败 */
  private captureResourceErrors(monitor: MonitorCore): void {
    window.addEventListener(
      'error',
      (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target || !('src' in target || 'href' in target)) return;

        const src = ('src' in target && typeof target.src === 'string' ? target.src : '') ||
                   ('href' in target && typeof target.href === 'string' ? target.href : '');

        const errorData: ErrorData = {
          errorType: 'resource',
          message: `Failed to load resource: ${src}`,
          filename: src,
          errorId: generateErrorId('resource:' + src),
        };
        monitor.report({
          type: 'error',
          timestamp: Date.now(),
          data: errorData,
        });
      },
      true, // 捕获阶段
    );
  }

  /** 劫持 console.error */
  private hijackConsoleError(monitor: MonitorCore): void {
    this.originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      this.originalConsoleError?.apply(console, args);

      const message = args.map((arg) =>
        arg instanceof Error ? arg.message : String(arg),
      ).join(' ');

      const errorData: ErrorData = {
        errorType: 'console',
        message,
        errorId: generateErrorId('console:' + message.substring(0, 200)),
      };
      monitor.report({
        type: 'error',
        timestamp: Date.now(),
        data: errorData,
      });
    };
  }

  private buildErrorData(event: ErrorEvent, category: ErrorCategory): ErrorData {
    return {
      errorType: category,
      message: event.message || 'Unknown error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      errorId: generateErrorId(
        event.error instanceof Error ? (event.error.stack || event.message || 'unknown') : (event.message || 'unknown'),
      ),
    };
  }
}

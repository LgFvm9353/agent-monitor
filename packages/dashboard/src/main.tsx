/**
 * Dashboard 入口
 *
 * 启用 SDK 自监控 (Dogfooding)：Dashboard 自身作为监控对象，
 * 将 Core Web Vitals、JS 错误、API 请求性能上报到后端。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin } from '@agenteye/monitor-sdk';
import App from './App';
import './global.css';

// ===== 自监控 SDK（Dogfooding） =====
const monitor = new Monitor({
  reportUrl: '/api/monitor/report',
  appId: 'dashboard-self',
  sampleRate: {
    error: 1,
    performance: 1,
    behavior: 0.3,
    custom: 1,
  },
});

monitor.use(new ErrorPlugin());
monitor.use(new PerformancePlugin());
monitor.use(new BehaviorPlugin());
monitor.start();

// 挂载前短暂延迟，确保 SDK 插件 setup 完毕
const rootEl = document.getElementById('root');
if (rootEl) {
  const observer = new MutationObserver(() => {
    if (rootEl.childElementCount > 0) {
      observer.disconnect();
    }
  });
  observer.observe(rootEl, { childList: true, subtree: true });
}

ReactDOM.createRoot(rootEl!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

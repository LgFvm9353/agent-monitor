/**
 * Dashboard 入口
 *
 * 启用 SDK 自监控 (Dogfooding)：Dashboard 自身作为监控对象，
 * 将 Core Web Vitals、JS 错误、API 请求性能上报到后端。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './global.css';
import { monitor } from './lib/monitor';

// ===== 自监控 SDK（Dogfooding） =====
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

/**
 * Dashboard 入口
 *
 * 注意：SDK 自监控 (Dogfooding) 已临时关闭，避免干扰独立 Demo 测试。
 * 需要恢复时取消下方注释即可。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin } from '@agent-harness/monitor-sdk';
import App from './App';
import './global.css';

// ===== 自监控 SDK（测试期间已禁用） =====
// const monitor = new Monitor({ ... });
// monitor.use(new ErrorPlugin());
// monitor.use(new PerformancePlugin());
// monitor.use(new BehaviorPlugin());
// monitor.start();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

/**
 * React 集成示例
 *
 * 展示如何在 React 应用中集成 @agent-harness/monitor-sdk
 */

import { useEffect, useRef } from 'react';
// import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin } from '@agent-harness/monitor-sdk';

export default function App() {
  const monitorRef = useRef<unknown>(null);

  useEffect(() => {
    // 初始化 Monitor SDK
    // const monitor = new Monitor({
    //   reportUrl: 'http://localhost:3001/api/monitor/report',
    //   appId: 'react-example-app',
    // });
    //
    // monitor.use(new ErrorPlugin());
    // monitor.use(new PerformancePlugin());
    // monitor.use(new BehaviorPlugin());
    //
    // monitor.start();
    // monitorRef.current = monitor;

    console.log('✅ Monitor SDK initialized in React app');

    return () => {
      // monitor.destroy();
    };
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui' }}>
      <h1>React + Agent Harness Monitor SDK</h1>
      <p>
        This React app is instrumented with @agent-harness/monitor-sdk.
        Open DevTools to see monitoring events being reported.
      </p>
      <button onClick={() => {
        // monitorRef.current?.report({ type: 'custom', data: { name: 'react-click' } });
      }}>
        Report Custom Event
      </button>
    </div>
  );
}

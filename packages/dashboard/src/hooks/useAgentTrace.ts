/**
 * useAgentTrace — WebSocket 实时 Trace Hook
 *
 * 连接后端 Trace WebSocket，接收实时 Agent 执行状态。
 *
 * 使用方式：
 *   const { isConnected, subscribe } = useAgentTrace();
 *   subscribe(traceId);
 */

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTraceStore } from '../store/traceStore';

export function useAgentTrace() {
  const socketRef = useRef<Socket | null>(null);
  const setConnected = useTraceStore((s) => s.setConnected);
  const appendRealtimeSpan = useTraceStore((s) => s.appendRealtimeSpan);

  useEffect(() => {
    const socket = io('http://localhost:3001/trace', {
      transports: ['websocket'],
      autoConnect: true,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // 监听实时 Trace 事件
    socket.on('trace:start', (data) => {
      console.log('[Trace] Started:', data.traceId);
    });

    socket.on('trace:step', (data) => {
      console.log('[Trace] Step:', data);
    });

    socket.on('trace:span', (data) => {
      appendRealtimeSpan(data.traceId, data.span);
    });

    socket.on('trace:done', (data) => {
      console.log('[Trace] Done:', data);
    });

    socket.on('trace:error', (data) => {
      console.error('[Trace] Error:', data);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [setConnected, appendRealtimeSpan]);

  const subscribe = useCallback((traceId: string) => {
    socketRef.current?.emit('subscribe', { traceId });
  }, []);

  return {
    subscribe,
    isConnected: useTraceStore((s) => s.isConnected),
  };
}

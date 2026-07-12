/**
 * useAgentTrace — WebSocket 实时 Trace Hook
 *
 * 连接后端 Trace WebSocket，接收实时 Agent 执行状态。
 * 当前单次 Run 详情页的主数据来源仍然是 HTTP run-detail 接口，
 * WebSocket 仅用于连接态展示与后续实时增强。
 */

import { useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTraceStore, type RuntimeEvent } from '../store/traceStore';

interface TraceEventPayload {
  traceId: string;
  event: RuntimeEvent;
}

export function useAgentTrace() {
  const socketRef = useRef<Socket | null>(null);
  const setConnected = useTraceStore((s) => s.setConnected);
  const appendRealtimeEvent = useTraceStore((s) => s.appendRealtimeEvent);

  useEffect(() => {
    const socket = io('http://localhost:3000/trace', {
      transports: ['websocket'],
      autoConnect: true,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('trace:start', (data) => {
      console.log('[Trace] Started:', data.traceId);
    });

    socket.on('trace:step', (data) => {
      console.log('[Trace] Step:', data);
    });

    socket.on('trace:event', (data: TraceEventPayload) => {
      appendRealtimeEvent(data.traceId, data.event);
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
  }, [setConnected, appendRealtimeEvent]);

  const subscribe = useCallback((traceId: string) => {
    socketRef.current?.emit('subscribe', { traceId });
  }, []);

  return {
    subscribe,
    isConnected: useTraceStore((s) => s.isConnected),
  };
}

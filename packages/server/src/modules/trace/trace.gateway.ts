/**
 * TraceGateway — WebSocket 实时推送 Trace 数据 ⭐
 *
 * Dashboard 的 Trace Explorer 通过 WebSocket 接收实时 Agent 执行状态，
 * 实现流式可视化更新。
 *
 * 事件：
 * - trace:start  — Agent 开始执行
 * - trace:step   — 新的执行步骤
 * - trace:span   — Span 创建/更新
 * - trace:done   — Agent 执行完成
 * - trace:error  — Agent 执行出错
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'trace',
})
export class TraceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedClients = 0;

  handleConnection(client: Socket) {
    this.connectedClients++;
    client.emit('connected', { clientId: client.id, connectedClients: this.connectedClients });
  }

  handleDisconnect() {
    this.connectedClients--;
  }

  /** 推送 Trace 开始事件 */
  emitTraceStart(traceId: string, data: Record<string, unknown>) {
    this.server.emit('trace:start', { traceId, ...data, timestamp: Date.now() });
  }

  /** 推送执行步骤 */
  emitTraceStep(traceId: string, step: Record<string, unknown>) {
    this.server.emit('trace:step', { traceId, step, timestamp: Date.now() });
  }

  /** 推送 Span 数据 */
  emitTraceSpan(traceId: string, span: Record<string, unknown>) {
    this.server.emit('trace:span', { traceId, span, timestamp: Date.now() });
  }

  /** 推送完成事件 */
  emitTraceDone(traceId: string, result: Record<string, unknown>) {
    this.server.emit('trace:done', { traceId, result, timestamp: Date.now() });
  }

  /** 推送错误 */
  emitTraceError(traceId: string, error: string) {
    this.server.emit('trace:error', { traceId, error, timestamp: Date.now() });
  }

  /** 客户端可以订阅特定 Trace */
  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { traceId: string }) {
    client.join(`trace:${payload.traceId}`);
    return { subscribed: payload.traceId };
  }
}

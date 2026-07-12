import { Injectable, Inject, Logger } from '@nestjs/common';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { monitorEvents } from '../../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { TraceService } from '../trace/trace.service';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    @Inject(DB_TOKEN) private db: DrizzleDB,
    private readonly traceService: TraceService,
  ) {}

  /** 接收前端 SDK 上报的事件 */
  async ingestEvents(events: Array<{
    eventId: string;
    type: string;
    data: unknown;
    meta: { url?: string; sessionId?: string; userAgent?: string; sdkVersion?: string; appId?: string };
    timestamp: number;
  }>) {
    const runtimeEvents = events.filter((event) => event.type === 'runtime');
    const normalEvents = events.filter((event) => event.type !== 'runtime');

    if (runtimeEvents.length > 0) {
      await this.ingestRuntimeEvents(runtimeEvents);
    }

    const now = Date.now();
    for (const event of normalEvents) {
      try {
        await this.db.insert(monitorEvents).values({
          id: event.eventId,
          appId: event.meta?.appId || 'unknown',
          type: event.type,
          data: JSON.stringify(event.data),
          url: event.meta?.url || '',
          sessionId: event.meta?.sessionId || '',
          userAgent: event.meta?.userAgent || '',
          sdkVersion: event.meta?.sdkVersion || '',
          timestamp: event.timestamp,
          receivedAt: now,
        });
      } catch (err) {
        const msg = (err as Error).message || '';
        // ER_DUP_ENTRY = 主键/唯一键冲突，属于正常去重
        if (!msg.includes('ER_DUP_ENTRY') && !msg.includes('Duplicate entry')) {
          this.logger.error(`[MonitorService] insert failed: ${event.eventId}`, msg);
        }
      }
    }
    return { received: events.length };
  }

  private async ingestRuntimeEvents(events: Array<{
    eventId: string;
    data: unknown;
    timestamp: number;
  }>): Promise<void> {
    const rows = events
      .map((event) => this.mapRuntimeEvent(event))
      .filter((event): event is {
        id: string;
        traceId: string;
        runId: string;
        parentId?: string;
        stepId?: string;
        kind: string;
        eventType: string;
        name: string;
        status: string;
        startTime: number;
        endTime?: number;
        durationMs?: number;
        input?: string;
        outputSummary?: string;
        error?: string;
        metadata?: string;
        createdAt: number;
      } => event !== null);

    for (const row of rows) {
      try {
        await this.traceService.saveRuntimeEvents([row]);
      } catch (err) {
        const msg = (err as Error).message || '';
        if (!msg.includes('ER_DUP_ENTRY') && !msg.includes('Duplicate entry')) {
          this.logger.error(`[MonitorService] runtime insert failed: ${row.id}`, msg);
        }
      }
    }
  }

  private mapRuntimeEvent(event: { eventId: string; data: unknown; timestamp: number }): {
    id: string;
    traceId: string;
    runId: string;
    parentId?: string;
    stepId?: string;
    kind: string;
    eventType: string;
    name: string;
    status: string;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    input?: string;
    outputSummary?: string;
    error?: string;
    metadata?: string;
    createdAt: number;
  } | null {
    if (!event.data || typeof event.data !== 'object') {
      return null;
    }

    const runtime = event.data as Record<string, unknown>;
    const traceId = this.readString(runtime.traceId);
    const runId = this.readString(runtime.runId);
    const kind = this.readString(runtime.kind);
    const eventType = this.readString(runtime.eventType);
    const name = this.readString(runtime.name);
    const status = this.readString(runtime.status);
    const startTime = this.readNumber(runtime.startTime);

    if (!traceId || !runId || !kind || !eventType || !name || status === null || startTime === null) {
      return null;
    }

    return {
      id: event.eventId,
      traceId,
      runId,
      parentId: this.readOptionalString(runtime.parentId),
      stepId: this.readOptionalString(runtime.stepId),
      kind,
      eventType,
      name,
      status,
      startTime,
      endTime: this.readOptionalNumber(runtime.endTime),
      durationMs: this.readOptionalNumber(runtime.durationMs),
      input: this.stringifyOptional(runtime.input),
      outputSummary: this.stringifyOptional(runtime.outputSummary),
      error: this.readOptionalString(runtime.error),
      metadata: this.stringifyOptional(runtime.metadata),
      createdAt: event.timestamp,
    };
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private stringifyOptional(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /** 查询最近的事件（支持按 appId + type 过滤） */
  async listEvents(appId?: string, type?: string, limit = 100, offset = 0) {
    const conditions = [];
    if (appId) conditions.push(eq(monitorEvents.appId, appId));
    if (type) conditions.push(eq(monitorEvents.type, type));

    const base = this.db.select().from(monitorEvents)
      .orderBy(desc(monitorEvents.timestamp))
      .limit(limit).offset(offset);

    if (conditions.length > 0) {
      return base.where(and(...conditions));
    }
    return base;
  }

  /** 按类型统计（支持按 appId 过滤）— SQL GROUP BY 聚合 */
  async getEventStats(appId?: string) {
    const conditions = appId ? [eq(monitorEvents.appId, appId)] : [];

    const rows = await this.db
      .select({
        type: monitorEvents.type,
        count: sql<number>`CAST(COUNT(*) AS DOUBLE)`,
      })
      .from(monitorEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(monitorEvents.type);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const c = Number(row.count);
      byType[row.type] = c;
      total += c;
    }

    return { total, byType };
  }
}

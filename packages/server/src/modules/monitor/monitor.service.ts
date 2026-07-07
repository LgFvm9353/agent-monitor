import { Injectable, Inject, Logger } from '@nestjs/common';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { monitorEvents } from '../../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(@Inject(DB_TOKEN) private db: DrizzleDB) {}

  /** 接收前端 SDK 上报的事件 */
  async ingestEvents(events: Array<{
    eventId: string;
    type: string;
    data: unknown;
    meta: { url?: string; sessionId?: string; userAgent?: string; sdkVersion?: string; appId?: string };
    timestamp: number;
  }>) {
    const now = Date.now();
    for (const event of events) {
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

import { Injectable, Inject } from '@nestjs/common';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { monitorEvents } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';

@Injectable()
export class MonitorService {
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
        this.db.insert(monitorEvents).values({
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
        }).run();
      } catch {
        // 忽略重复事件
      }
    }
    return { received: events.length };
  }

  /** 查询最近的事件（支持按 appId + type 过滤） */
  async listEvents(appId?: string, type?: string, limit = 100, offset = 0) {
    const conditions = [];
    if (appId) conditions.push(eq(monitorEvents.appId, appId));
    if (type) conditions.push(eq(monitorEvents.type, type));

    if (conditions.length > 0) {
      return this.db.select().from(monitorEvents)
        .where(and(...conditions))
        .orderBy(desc(monitorEvents.timestamp))
        .limit(limit).offset(offset)
        .all();
    }
    return this.db.select().from(monitorEvents)
      .orderBy(desc(monitorEvents.timestamp))
      .limit(limit).offset(offset)
      .all();
  }

  /** 按类型统计（支持按 appId 过滤） */
  async getEventStats(appId?: string) {
    let all;
    if (appId) {
      all = this.db.select().from(monitorEvents)
        .where(eq(monitorEvents.appId, appId))
        .all();
    } else {
      all = this.db.select().from(monitorEvents).all();
    }
    const stats: Record<string, number> = {};
    for (const event of all) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }
    return { total: all.length, byType: stats };
  }
}

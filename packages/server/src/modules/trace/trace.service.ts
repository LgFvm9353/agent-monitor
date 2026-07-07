import { Injectable, Inject } from '@nestjs/common';
import { eq, desc, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { traces, traceSpans } from '../../db/schema';

@Injectable()
export class TraceService {
  constructor(@Inject(DB_TOKEN) private db: DrizzleDB) {}

  async saveTrace(data: {
    id: string; sessionId: string; model: string; metadata: string;
    success: boolean; error?: string; inputTokens: number; outputTokens: number;
    estimatedCost?: number; durationMs: number; tags?: string; createdAt: number;
  }) {
    return this.db.insert(traces).values(data);
  }

  /** 更新 Trace 的最终状态（tokens, cost, duration, success） */
  async updateTrace(id: string, data: {
    success: boolean; error?: string;
    inputTokens: number; outputTokens: number;
    estimatedCost?: number; durationMs: number;
  }) {
    return this.db.update(traces).set(data).where(eq(traces.id, id));
  }

  async saveSpan(data: {
    id: string; traceId: string; parentSpanId?: string; name: string; type: string;
    startTime: number; endTime: number; input?: string; output?: string;
    status: string; statusMessage?: string; metadata?: string;
  }) {
    return this.db.insert(traceSpans).values(data);
  }

  async listTraces(limit = 50, offset = 0) {
    return this.db.select().from(traces)
      .orderBy(desc(traces.createdAt)).limit(limit).offset(offset);
  }

  async getTraceWithSpans(traceId: string) {
    const rows = await this.db.select().from(traces)
      .where(eq(traces.id, traceId)).limit(1);
    const trace = rows[0] || null;
    if (!trace) return null;
    const spans = await this.db.select().from(traceSpans)
      .where(eq(traceSpans.traceId, traceId));
    return { trace, spans };
  }

  async getStats() {
    // 聚合查询 — 使用 SQL 聚合函数替代全量加载到内存
    const aggResult = await this.db
      .select({
        total: sql<number>`CAST(COUNT(*) AS DOUBLE)`,
        successful: sql<number>`CAST(SUM(CASE WHEN ${traces.success} = true THEN 1 ELSE 0 END) AS DOUBLE)`,
        failed: sql<number>`CAST(SUM(CASE WHEN ${traces.success} = false THEN 1 ELSE 0 END) AS DOUBLE)`,
        avgDurationMs: sql<number>`CAST(AVG(${traces.durationMs}) AS DOUBLE)`,
        totalInputTokens: sql<number>`CAST(SUM(${traces.inputTokens}) AS DOUBLE)`,
        totalOutputTokens: sql<number>`CAST(SUM(${traces.outputTokens}) AS DOUBLE)`,
        totalEstimatedCost: sql<number>`CAST(SUM(COALESCE(${traces.estimatedCost}, 0)) AS DOUBLE)`,
      })
      .from(traces);

    const r = aggResult[0];
    const total = Number(r.total) || 0;
    const successful = Number(r.successful) || 0;
    const failed = Number(r.failed) || 0;

    // modelDistribution 需要 GROUP BY 查询
    const modelRows = await this.db
      .select({
        model: traces.model,
        count: sql<number>`CAST(COUNT(*) AS DOUBLE)`,
      })
      .from(traces)
      .groupBy(traces.model);

    const modelDistribution: Record<string, number> = {};
    for (const row of modelRows) {
      modelDistribution[row.model] = Number(row.count);
    }

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? successful / total : 0,
      avgDurationMs: Math.round(Number(r.avgDurationMs) || 0),
      totalInputTokens: Number(r.totalInputTokens) || 0,
      totalOutputTokens: Number(r.totalOutputTokens) || 0,
      totalEstimatedCost: Number(r.totalEstimatedCost) || 0,
      modelDistribution,
    };
  }
}

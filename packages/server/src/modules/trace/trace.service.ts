import { Injectable, Inject } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
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
    return this.db.insert(traces).values(data).run();
  }

  async saveSpan(data: {
    id: string; traceId: string; parentSpanId?: string; name: string; type: string;
    startTime: number; endTime: number; input?: string; output?: string;
    status: string; statusMessage?: string; metadata?: string;
  }) {
    return this.db.insert(traceSpans).values(data).run();
  }

  async listTraces(limit = 50, offset = 0) {
    return this.db.select().from(traces)
      .orderBy(desc(traces.createdAt)).limit(limit).offset(offset).all();
  }

  async getTraceWithSpans(traceId: string) {
    const trace = this.db.select().from(traces).where(eq(traces.id, traceId)).get();
    if (!trace) return null;
    const spans = this.db.select().from(traceSpans)
      .where(eq(traceSpans.traceId, traceId)).all();
    return { trace, spans };
  }

  async getStats() {
    const allTraces = this.db.select().from(traces).all();
    const total = allTraces.length;
    const successful = allTraces.filter((t: typeof allTraces[number]) => t.success).length;
    const avgDuration = total > 0
      ? allTraces.reduce((sum: number, t: typeof allTraces[number]) => sum + t.durationMs, 0) / total
      : 0;
    const totalCost = allTraces.reduce(
      (sum: number, t: typeof allTraces[number]) => sum + (t.estimatedCost || 0), 0,
    );
    const modelDistribution: Record<string, number> = {};
    allTraces.forEach((t: typeof allTraces[number]) => {
      modelDistribution[t.model] = (modelDistribution[t.model] || 0) + 1;
    });
    return {
      total, successful, failed: total - successful,
      successRate: total > 0 ? successful / total : 0,
      avgDurationMs: Math.round(avgDuration),
      totalInputTokens: allTraces.reduce((s: number, t: typeof allTraces[number]) => s + t.inputTokens, 0),
      totalOutputTokens: allTraces.reduce((s: number, t: typeof allTraces[number]) => s + t.outputTokens, 0),
      totalEstimatedCost: totalCost, modelDistribution,
    };
  }
}

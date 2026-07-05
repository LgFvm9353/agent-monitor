import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { evalDatasets, evalRuns } from '../../db/schema';

@Injectable()
export class EvalService {
  constructor(@Inject(DB_TOKEN) private db: DrizzleDB) {}

  async createDataset(name: string, description?: string) {
    const id = `ds-${Date.now().toString(36)}`;
    const now = Date.now();
    await this.db.insert(evalDatasets).values({
      id, name, description: description || '',
      items: '[]', createdAt: now, updatedAt: now,
    });
    const rows = await this.db.select().from(evalDatasets)
      .where(eq(evalDatasets.id, id)).limit(1);
    return rows[0] || null;
  }

  async listDatasets() {
    return this.db.select().from(evalDatasets);
  }

  async getDataset(id: string) {
    const rows = await this.db.select().from(evalDatasets)
      .where(eq(evalDatasets.id, id)).limit(1);
    return rows[0] || null;
  }

  async addItem(datasetId: string, input: string, expectedOutput?: string, labels?: string[]) {
    const ds = await this.getDataset(datasetId);
    if (!ds) throw new Error(`Dataset ${datasetId} not found`);

    const items = JSON.parse(ds.items);
    items.push({
      id: `item-${Date.now().toString(36)}`,
      input,
      expectedOutput,
      labels: labels || [],
    });

    await this.db.update(evalDatasets)
      .set({ items: JSON.stringify(items), updatedAt: Date.now() })
      .where(eq(evalDatasets.id, datasetId));

    return this.getDataset(datasetId);
  }

  async listRuns(datasetId?: string) {
    if (datasetId) {
      return this.db.select().from(evalRuns).where(eq(evalRuns.datasetId, datasetId));
    }
    return this.db.select().from(evalRuns);
  }

  async createRun(data: {
    id: string;
    datasetId: string;
    agentConfig: string;
    scores: string;
    startTime: number;
    endTime: number;
    passRate: number;
    scorerAverages: string;
  }) {
    await this.db.insert(evalRuns).values(data);
    const rows = await this.db.select().from(evalRuns)
      .where(eq(evalRuns.id, data.id)).limit(1);
    return rows[0] || null;
  }
}

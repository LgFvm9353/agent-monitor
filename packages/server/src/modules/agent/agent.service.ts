import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { agentConfigs } from '../../db/schema';

@Injectable()
export class AgentService {
  constructor(@Inject(DB_TOKEN) private db: DrizzleDB) {}

  async listConfigs() {
    return this.db.select().from(agentConfigs).where(eq(agentConfigs.active, true)).all();
  }

  async getConfig(id: string) {
    return this.db.select().from(agentConfigs).where(eq(agentConfigs.id, id)).get();
  }

  async createConfig(name: string, config: Record<string, unknown>) {
    const id = `cfg-${Date.now().toString(36)}`;
    const now = Date.now();
    this.db.insert(agentConfigs).values({
      id, name, config: JSON.stringify(config),
      active: true, createdAt: now, updatedAt: now,
    }).run();
    return this.getConfig(id);
  }

  async updateConfig(id: string, config: Record<string, unknown>) {
    this.db.update(agentConfigs)
      .set({ config: JSON.stringify(config), updatedAt: Date.now() })
      .where(eq(agentConfigs.id, id))
      .run();
    return this.getConfig(id);
  }

  async deleteConfig(id: string) {
    this.db.update(agentConfigs)
      .set({ active: false, updatedAt: Date.now() })
      .where(eq(agentConfigs.id, id))
      .run();
    return { deleted: id };
  }
}

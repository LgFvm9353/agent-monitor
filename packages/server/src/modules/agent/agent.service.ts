import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { agentConfigs } from '../../db/schema';
import {
  AgentRunner,
  createOpenAIAdapter,
  type ModelAdapter,
  type StreamEvent,
} from '@agent-harness/core';

@Injectable()
export class AgentService {
  constructor(@Inject(DB_TOKEN) private db: DrizzleDB) {}

  // ===== Config CRUD =====

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

  // ===== Agent Execution =====

  /**
   * 创建 AgentRunner 实例
   */
  private createRunner(options: {
    provider: 'openai' | 'anthropic';
    apiKey: string;
    modelId: string;
    baseURL?: string;
  }): { runner: AgentRunner; adapter: ModelAdapter } {
    const adapter = createOpenAIAdapter({
      apiKey: options.apiKey,
      modelId: options.modelId,
      baseURL: options.provider === 'openai' ? options.baseURL : undefined,
    });

    const runner = new AgentRunner(adapter);
    return { runner, adapter };
  }

  /**
   * 流式执行 Agent（返回 AsyncGenerator）
   *
   * @param input - 用户输入
   * @param config - Agent 配置
   * @returns StreamEvent 异步生成器
   */
  async *runAgentStream(
    input: string,
    config: {
      provider?: 'openai' | 'anthropic';
      apiKey?: string;
      modelId?: string;
      baseURL?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Record<string, {
        execute: (args: Record<string, unknown>) => Promise<unknown>;
        description: string;
        parameters: Record<string, unknown>;
      }>;
    },
  ): AsyncGenerator<StreamEvent> {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    const modelId = config.modelId || 'gpt-4o';
    const provider = config.provider || 'openai';

    if (!apiKey) {
      yield { type: 'error', message: 'No API key configured. Set OPENAI_API_KEY environment variable or pass apiKey in request.' };
      return;
    }

    const { runner } = this.createRunner({
      provider,
      apiKey,
      modelId,
      baseURL: config.baseURL || process.env.OPENAI_BASE_URL,
    });

    // 注册工具
    if (config.tools) {
      runner.withTools(config.tools);
    }

    // 执行
    yield* runner.runStream(input, {
      model: modelId,
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
  }
}

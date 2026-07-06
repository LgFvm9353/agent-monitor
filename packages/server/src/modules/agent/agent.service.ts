import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/schema';
import { DB_TOKEN } from '../../db/drizzle.module';
import { agentConfigs } from '../../db/schema';
import {
  AgentRunner,
  createOpenAIAdapter,
  MemoryManager,
  type ModelAdapter,
  type StreamEvent,
} from '@agent-harness/core';
import { MonitorService } from '../monitor/monitor.service';
import { TraceService } from '../trace/trace.service';
import { createQueryMonitorEventsTool, createGetMonitorStatsTool } from './tools/monitor-tools';

@Injectable()
export class AgentService {
  /** 会话级记忆存储：sessionId → MemoryManager */
  private sessionMemories = new Map<string, MemoryManager>();

  constructor(
    @Inject(DB_TOKEN) private db: DrizzleDB,
    private readonly monitorService: MonitorService,
    private readonly traceService: TraceService,
  ) {}

  /** 获取或创建会话记忆 */
  private getSessionMemory(sessionId: string): MemoryManager {
    let memory = this.sessionMemories.get(sessionId);
    if (!memory) {
      memory = new MemoryManager();
      memory.configure({ type: 'buffer', maxTurns: 20 });
      this.sessionMemories.set(sessionId, memory);
    }
    return memory;
  }

  // ===== Config CRUD =====

  async listConfigs() {
    return this.db.select().from(agentConfigs).where(eq(agentConfigs.active, true));
  }

  async getConfig(id: string) {
    const rows = await this.db.select().from(agentConfigs)
      .where(eq(agentConfigs.id, id)).limit(1);
    return rows[0] || null;
  }

  async createConfig(name: string, config: Record<string, unknown>) {
    const id = `cfg-${Date.now().toString(36)}`;
    const now = Date.now();
    await this.db.insert(agentConfigs).values({
      id, name, config: JSON.stringify(config),
      active: true, createdAt: now, updatedAt: now,
    });
    return this.getConfig(id);
  }

  async updateConfig(id: string, config: Record<string, unknown>) {
    await this.db.update(agentConfigs)
      .set({ config: JSON.stringify(config), updatedAt: Date.now() })
      .where(eq(agentConfigs.id, id));
    return this.getConfig(id);
  }

  async deleteConfig(id: string) {
    await this.db.update(agentConfigs)
      .set({ active: false, updatedAt: Date.now() })
      .where(eq(agentConfigs.id, id));
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
   * 同时持久化 trace 和 span 到数据库，供 Trace Explorer 查询。
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
      sessionId?: string;
      enabledTools?: string[];
      tools?: Record<string, {
        execute: (args: Record<string, unknown>) => Promise<unknown>;
        description: string;
        parameters: Record<string, unknown>;
      }>;
    },
  ): AsyncGenerator<StreamEvent> {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    const modelId = config.modelId || 'deepseek-v4-pro';
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

    // 注册工具（根据 enabledTools 过滤）
    const allMonitorTools: Record<string, {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
      description: string;
      parameters: Record<string, unknown>;
    }> = {
      queryMonitorEvents: createQueryMonitorEventsTool(this.monitorService),
      getMonitorStats: createGetMonitorStatsTool(this.monitorService),
    };

    // 如果前端传了 enabledTools，只启用指定的工具；否则全部启用
    const monitorTools: Record<string, {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
      description: string;
      parameters: Record<string, unknown>;
    }> = {};
    if (config.enabledTools && config.enabledTools.length > 0) {
      for (const toolId of config.enabledTools) {
        if (allMonitorTools[toolId]) {
          monitorTools[toolId] = allMonitorTools[toolId];
        }
      }
    } else {
      Object.assign(monitorTools, allMonitorTools);
    }

    const allTools = config.tools
      ? { ...monitorTools, ...config.tools }
      : monitorTools;

    runner.withTools(allTools);

    // ===== 会话记忆 =====
    const sessionId = config.sessionId || `sess-${Date.now().toString(36)}`;
    const sessionMemory = this.getSessionMemory(sessionId);
    runner.withExternalMemory(sessionMemory);

    // ===== Trace 记录 =====
    const traceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const traceStartTime = Date.now();

    // 保存初始 trace 记录
    try {
      await this.traceService.saveTrace({
        id: traceId,
        sessionId,
        model: modelId,
        metadata: JSON.stringify({ provider, temperature: config.temperature, systemPrompt: config.systemPrompt?.slice(0, 200) }),
        success: false,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        durationMs: 0,
        createdAt: traceStartTime,
      });
    } catch (err) {
      console.error('Failed to save initial trace:', err);
    }

    // Span 时序追踪
    interface SpanTiming {
      name: string;
      type: string;
      startTime: number;
      endTime?: number;
      input?: string;
      output?: string;
      status: string;
      statusMessage?: string;
      parentSpanId?: string;
    }
    const spanTimings = new Map<string, SpanTiming>();
    let currentStepSpanId: string | null = null;

    // 消息跟踪（用于会话记忆持久化）
    let assistantOutput = '';
    const toolCallsMade: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const toolMessages: Array<{ id: string; name: string; result: unknown; error?: string }> = [];
    const pendingToolArgs = new Map<string, string>(); // id → 累积的 args JSON
    const pendingToolNames = new Map<string, string>(); // id → name

    // 执行
    const stream = runner.runStream(input, {
      model: modelId,
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    try {
      for await (const event of stream) {
        // 追踪 span 时序
        switch (event.type) {
          case 'step-start': {
            const spanId = `span-${traceId}-step-${event.stepIndex}`;
            currentStepSpanId = spanId;
            spanTimings.set(spanId, {
              name: `LLM Call #${event.stepIndex + 1}`,
              type: 'llm',
              startTime: Date.now(),
              status: 'ok',
            });
            break;
          }
          case 'step-end': {
            if (currentStepSpanId) {
              const timing = spanTimings.get(currentStepSpanId);
              if (timing) timing.endTime = Date.now();
            }
            break;
          }
          case 'tool-call-start': {
            const spanId = `span-${traceId}-tool-${event.id}`;
            spanTimings.set(spanId, {
              name: `Tool: ${event.name}`,
              type: 'tool',
              startTime: Date.now(),
              status: 'ok',
              parentSpanId: currentStepSpanId || undefined,
            });
            // 跟踪 tool call 信息（用于记忆持久化）
            pendingToolArgs.set(event.id, '');
            pendingToolNames.set(event.id, event.name);
            break;
          }
          case 'tool-call-args': {
            // 累积工具调用参数
            const existing = pendingToolArgs.get(event.id) || '';
            pendingToolArgs.set(event.id, existing + event.args);
            break;
          }
          case 'tool-call-end': {
            // 解析完成的工具调用参数
            const argsStr = pendingToolArgs.get(event.id) || '{}';
            const toolName = pendingToolNames.get(event.id) || '';
            try {
              const args = JSON.parse(argsStr);
              toolCallsMade.push({ id: event.id, name: toolName, arguments: args });
            } catch {
              toolCallsMade.push({ id: event.id, name: toolName, arguments: {} });
            }
            break;
          }
          case 'text-delta': {
            // 累积 assistant 输出（用于会话记忆）
            assistantOutput += event.content;
            break;
          }
          case 'tool-result': {
            const spanId = `span-${traceId}-tool-${event.id}`;
            const timing = spanTimings.get(spanId);
            if (timing) {
              timing.endTime = Date.now();
              timing.output = typeof event.result === 'string'
                ? event.result.slice(0, 1000)
                : JSON.stringify(event.result).slice(0, 1000);
              if (event.error) {
                timing.status = 'error';
                timing.statusMessage = event.error;
              }
            }
            // 记录工具消息（用于会话记忆）
            toolMessages.push({ id: event.id, name: event.name, result: event.result, error: event.error });
            break;
          }
          case 'done': {
            // 保存所有 spans
            const spanPromises: Promise<unknown>[] = [];
            for (const [spanId, timing] of spanTimings) {
              spanPromises.push(
                this.traceService.saveSpan({
                  id: spanId,
                  traceId,
                  parentSpanId: timing.parentSpanId,
                  name: timing.name,
                  type: timing.type,
                  startTime: timing.startTime,
                  endTime: timing.endTime || Date.now(),
                  input: timing.input,
                  output: timing.output,
                  status: timing.status,
                  statusMessage: timing.statusMessage,
                }).catch(err => console.error(`Failed to save span ${spanId}:`, err))
              );
            }
            await Promise.all(spanPromises);

            // 计算费用
            const inputTokens = event.tokens.input;
            const outputTokens = event.tokens.output;
            const estimatedCost = this.estimateCost(modelId, inputTokens, outputTokens);
            const durationMs = Date.now() - traceStartTime;

            // 更新 trace
            try {
              await this.traceService.updateTrace(traceId, {
                success: true,
                inputTokens,
                outputTokens,
                estimatedCost,
                durationMs,
              });
            } catch (err) {
              console.error('Failed to update trace:', err);
            }

            // ===== 保存消息到会话记忆 =====
            // API 要求的消息顺序: assistant(tool_calls) → tool(tool_call_id) → assistant(text)
            sessionMemory.addMessage({ role: 'user', content: input });

            const hasToolCalls = event.toolCalls && event.toolCalls.length > 0;
            if (hasToolCalls) {
              // 工具调用的 assistant 消息（content 为空，携带 tool_calls）
              sessionMemory.addMessage({
                role: 'assistant',
                content: '',
                toolCalls: event.toolCalls.map(tc => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                })),
              });
              // 工具结果消息
              for (const tm of toolMessages) {
                sessionMemory.addMessage({
                  role: 'tool',
                  content: tm.error || JSON.stringify(tm.result),
                  name: tm.name,
                  toolCallId: tm.id,
                });
              }
            }

            // 最终文本响应
            if (assistantOutput) {
              sessionMemory.addMessage({ role: 'assistant', content: assistantOutput });
            }
            break;
          }
          case 'error': {
            // 保存已有的 spans
            const spanPromises: Promise<unknown>[] = [];
            for (const [spanId, timing] of spanTimings) {
              if (timing.endTime) {
                spanPromises.push(
                  this.traceService.saveSpan({
                    id: spanId,
                    traceId,
                    parentSpanId: timing.parentSpanId,
                    name: timing.name,
                    type: timing.type,
                    startTime: timing.startTime,
                    endTime: timing.endTime,
                    status: timing.status,
                    statusMessage: timing.statusMessage,
                  }).catch(err => console.error(`Failed to save span ${spanId}:`, err))
                );
              }
            }
            await Promise.all(spanPromises);

            // 更新 trace 为失败
            try {
              await this.traceService.updateTrace(traceId, {
                success: false,
                error: event.message,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                durationMs: Date.now() - traceStartTime,
              });
            } catch (err) {
              console.error('Failed to update trace on error:', err);
            }

            // ===== 保存已有消息到会话记忆 =====
            sessionMemory.addMessage({ role: 'user', content: input });

            if (toolCallsMade.length > 0) {
              // 工具调用的 assistant 消息
              sessionMemory.addMessage({
                role: 'assistant',
                content: '',
                toolCalls: toolCallsMade.map(tc => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                })),
              });
              // 工具结果消息
              for (const tm of toolMessages) {
                sessionMemory.addMessage({
                  role: 'tool',
                  content: tm.error || JSON.stringify(tm.result),
                  name: tm.name,
                  toolCallId: tm.id,
                });
              }
            }

            // 已累积的文本
            if (assistantOutput) {
              sessionMemory.addMessage({ role: 'assistant', content: assistantOutput });
            }
            break;
          }
        }

        // 透传事件给前端
        yield event;

        if (event.type === 'done' || event.type === 'error') {
          return;
        }
      }
    } catch (error) {
      // 未捕获异常 — 更新 trace 为失败
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await this.traceService.updateTrace(traceId, {
          success: false,
          error: errorMsg,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
          durationMs: Date.now() - traceStartTime,
        });
      } catch (err) {
        console.error('Failed to update trace on exception:', err);
      }
      yield { type: 'error', message: errorMsg };
    }
  }

  /** DeepSeek 费用估算（单位：USD / 1M tokens） */
  private estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'deepseek-v4-pro': { input: 0.55, output: 2.19 },
      'deepseek-v4-flash': { input: 0.14, output: 0.55 },
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
    };
    const price = pricing[modelId] || { input: 1.0, output: 4.0 };
    return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  }
}

/**
 * Agent Runner — Agent 执行引擎
 *
 * 核心循环（体现对 Agent 本质的理解）：
 *
 *   ┌──────────────────────────────────────────┐
 *   │          Agent Execution Loop             │
 *   │                                          │
 *   │  User Input ──► LLM Call ──► Response?   │
 *   │                    │           │         │
 *   │                    ▼           ▼         │
 *   │               Tool Call?    Final Output  │
 *   │                    │                      │
 *   │                    ▼                      │
 *   │            Tool Execution                 │
 *   │                    │                      │
 *   │                    ▼                      │
 *   │            Back to LLM ◄──────────────────│
 *   │                                          │
 *   └──────────────────────────────────────────┘
 *
 * 这是 AI Agent 区别于普通 ChatBot 的核心：
 * Agent 不是单次问答，而是一个「思考→行动→观察→再思考」的循环。
 */

import { EventEmitter } from 'events';
import type {
  AgentConfig,
  AgentTrace,
  AgentSpan,
  TraceMetadata,
  TokenUsage,
} from '../types';
import type {
  ModelAdapter,
  AgentMessage,
  AgentResult,
  AgentStep,
  RunContext,
  ToolCallRecord,
  ToolCall,
  RunMetrics,
  ToolRegistryLike,
} from './types';
import { ToolRegistry } from '../tool/registry';
import { MiddlewarePipeline } from '../middleware/pipeline';
import { MemoryManager } from '../memory/manager';
import { createTracer } from '../trace/tracer';

export class AgentRunner {
  private adapter: ModelAdapter;
  private tools: ToolRegistry;
  private middleware: MiddlewarePipeline;
  private memory: MemoryManager;
  private events: EventEmitter;
  private tracer = createTracer();

  constructor(adapter: ModelAdapter) {
    this.adapter = adapter;
    this.tools = new ToolRegistry();
    this.middleware = new MiddlewarePipeline();
    this.memory = new MemoryManager();
    this.events = new EventEmitter();
  }

  // ===== Builder Pattern =====

  /** 注册工具 */
  withTools(tools: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; description: string; parameters: Record<string, unknown> }>): this {
    for (const [name, tool] of Object.entries(tools)) {
      this.tools.register({ name, ...tool });
    }
    return this;
  }

  /** 添加中间件 */
  withMiddleware(middleware: { name: string; handler: (ctx: RunContext, next: () => Promise<AgentResult>) => Promise<AgentResult> }): this {
    this.middleware.use(middleware);
    return this;
  }

  /** 设置记忆 */
  withMemory(config?: AgentConfig['memory']): this {
    this.memory.configure(config);
    return this;
  }

  /** 监听事件 */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  // ===== Run =====

  /**
   * 执行 Agent 任务
   *
   * @param userMessage - 用户输入
   * @param config - Agent 配置
   * @returns Agent 执行结果
   */
  async run(
    userMessage: string,
    config: Omit<AgentConfig, 'tools' | 'middleware' | 'memory'>,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const traceId = this.tracer.startTrace('agent-run', { sessionId: crypto.randomUUID?.() ?? Date.now().toString(36) });

    const steps: AgentStep[] = [];
    const toolCalls: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // 构建消息列表
    const messages: AgentMessage[] = [
      { role: 'system', content: config.systemPrompt },
      ...this.memory.getHistory(),
      { role: 'user', content: userMessage },
    ];

    // 构建运行上下文
    const context: RunContext = {
      config: { ...config },
      messages,
      currentStep: 0,
      maxSteps: 20, // 防止 Agent 无限循环
      tools: this.tools,
      addStep: (step) => steps.push(step),
      getMetrics: (): RunMetrics => ({
        stepCount: steps.length,
        toolCallCount: toolCalls.length,
        totalTokens: totalInputTokens + totalOutputTokens,
        elapsedMs: Date.now() - startTime,
      }),
    };

    try {
      // 通过中间件管道执行
      const finalHandler = async (): Promise<AgentResult> => {
        return this.executeLoop(context, {
          traceId,
          steps,
          toolCalls,
          getInputTokens: () => totalInputTokens,
          addInputTokens: (t) => { totalInputTokens += t; },
          getOutputTokens: () => totalOutputTokens,
          addOutputTokens: (t) => { totalOutputTokens += t; },
          startTime,
        });
      };

      const result = await this.middleware.run(context, finalHandler);
      return result;
    } catch (error) {
      return this.buildErrorResult(
        error instanceof Error ? error.message : String(error),
        traceId, startTime, steps, totalInputTokens, totalOutputTokens
      );
    }
  }

  /**
   * 流式执行 Agent
   */
  async *runStream(
    userMessage: string,
    config: Omit<AgentConfig, 'tools' | 'middleware' | 'memory'>,
  ): AsyncGenerator<{ type: 'text' | 'tool_call' | 'step' | 'done' | 'error'; data: unknown }> {
    // 简化版流式实现
    const messages: AgentMessage[] = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const toolDefs = this.tools.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.execute,
    }));

    for (let i = 0; i < 20; i++) {
      yield { type: 'step', data: { step: i + 1 } };

      // 流式调用 LLM
      let fullContent = '';
      let pendingToolCalls: ToolCall[] = [];

      for await (const chunk of this.adapter.chatStream(messages, {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
      })) {
        if (chunk.content) {
          fullContent += chunk.content;
          yield { type: 'text', data: chunk.content };
        }
        if (chunk.toolCallDelta) {
          // 累积 tool call delta
          yield { type: 'tool_call', data: chunk.toolCallDelta };
        }
      }

      // 检查是否需要执行工具
      if (pendingToolCalls.length > 0) {
        messages.push({ role: 'assistant', content: fullContent, toolCalls: pendingToolCalls });

        for (const tc of pendingToolCalls) {
          const result = await this.tools.execute(tc.name, tc.arguments);
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: tc.id,
            name: tc.name,
          });
        }
      } else {
        yield { type: 'done', data: { content: fullContent } };
        return;
      }
    }

    yield { type: 'error', data: 'Agent exceeded maximum steps' };
  }

  // ===== Private: Execution Loop =====

  private async executeLoop(
    ctx: RunContext,
    state: {
      traceId: string;
      steps: AgentStep[];
      toolCalls: ToolCallRecord[];
      getInputTokens: () => number;
      addInputTokens: (t: number) => void;
      getOutputTokens: () => number;
      addOutputTokens: (t: number) => void;
      startTime: number;
    },
  ): Promise<AgentResult> {
    const { traceId, steps, toolCalls, addInputTokens, addOutputTokens, startTime } = state;

    for (let i = 0; i < ctx.maxSteps; i++) {
      ctx.currentStep = i;

      // Step: LLM Call
      const llmSpanId = this.tracer.startSpan(traceId, 'llm-call', 'llm', { step: i });
      const llmStart = Date.now();

      // Token 计数（如果适配器支持）
      if (this.adapter.countTokens) {
        addInputTokens(this.adapter.countTokens(ctx.messages));
      }

      const response = await this.adapter.chat(ctx.messages, {
        maxTokens: ctx.config.maxTokens,
        temperature: ctx.config.temperature,
        tools: ctx.tools.list().map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          execute: t.execute,
        })),
      });

      addOutputTokens(response.usage?.outputTokens || 0);

      steps.push({
        stepIndex: i,
        type: 'llm_call',
        name: `LLM Call #${i + 1}`,
        input: ctx.messages[ctx.messages.length - 1]?.content,
        output: response.content,
        startTime: llmStart,
        endTime: Date.now(),
        tokens: { input: response.usage?.inputTokens || 0, output: response.usage?.outputTokens || 0 },
      });

      this.tracer.endSpan(llmSpanId, { output: response.content?.substring(0, 500) });

      this.events.emit('step', { stepIndex: i, type: 'llm', content: response.content });

      // 添加 assistant 消息
      ctx.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls?.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });

      // 检查是否需要执行工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          const toolSpanId = this.tracer.startSpan(traceId, `tool:${tc.name}`, 'tool', { tool: tc.name });

          const toolStart = Date.now();
          try {
            const result = await ctx.tools.execute(tc.name, tc.arguments);
            const toolRecord: ToolCallRecord = {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result,
              duration: Date.now() - toolStart,
            };
            toolCalls.push(toolRecord);

            steps.push({
              stepIndex: i,
              type: 'tool_call',
              name: `Tool: ${tc.name}`,
              input: tc.arguments,
              output: result,
              startTime: toolStart,
              endTime: Date.now(),
            });

            this.tracer.endSpan(toolSpanId, { result: String(result).substring(0, 500) });

            this.events.emit('tool-call', toolRecord);

            // 在消息末尾追加 tool 结果
            ctx.messages.push({
              role: 'tool',
              content: String(result),
              toolCallId: tc.id,
              name: tc.name,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const toolRecord: ToolCallRecord = {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: null,
              duration: Date.now() - toolStart,
              error: errorMsg,
            };
            toolCalls.push(toolRecord);

            this.tracer.endSpan(toolSpanId, { error: errorMsg }, 'error');

            ctx.messages.push({
              role: 'tool',
              content: `Error: ${errorMsg}`,
              toolCallId: tc.id,
              name: tc.name,
            });
          }
        }

        // Continue loop → LLM processes tool results
        continue;
      }

      // No tool calls → final response
      this.tracer.endTrace(traceId, {
        startTime,
        endTime: Date.now(),
        model: ctx.config.model,
        tokens: {
          input: state.getInputTokens(),
          output: state.getOutputTokens(),
        },
        success: true,
      });

      this.events.emit('done', { output: response.content });

      return {
        output: response.content,
        toolCalls,
        tokens: {
          input: state.getInputTokens(),
          output: state.getOutputTokens(),
          total: state.getInputTokens() + state.getOutputTokens(),
        },
        duration: Date.now() - startTime,
        steps,
        success: true,
        traceId,
      };
    }

    // Max steps exceeded
    return this.buildErrorResult(
      `Agent exceeded maximum of ${ctx.maxSteps} steps`,
      traceId, startTime, steps, state.getInputTokens(), state.getOutputTokens()
    );
  }

  private buildErrorResult(
    error: string,
    traceId: string,
    startTime: number,
    steps: AgentStep[],
    inputTokens: number,
    outputTokens: number,
  ): AgentResult {
    this.tracer.endTrace(traceId, { error, success: false });
    this.events.emit('error', { error });
    return {
      output: '',
      toolCalls: [],
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      duration: Date.now() - startTime,
      steps,
      success: false,
      error,
      traceId,
    };
  }
}

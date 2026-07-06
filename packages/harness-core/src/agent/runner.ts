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
  StreamEvent,
} from './types';
import { ToolRegistry } from '../tool/registry';
import { MiddlewarePipeline } from '../middleware/pipeline';
import { MemoryManager } from '../memory/manager';
import { createTracer, StepRecorder, BreakpointManager } from '../trace/tracer';
import { StreamAccumulator } from './adapter';
import type { Guardrail } from '../guardrail/types';

export class AgentRunner {
  private adapter: ModelAdapter;
  private tools: ToolRegistry;
  private middleware: MiddlewarePipeline;
  private memory: MemoryManager;
  private events: EventEmitter;
  private tracer = createTracer();
  private guardrails: Guardrail[] = [];
  private stepRecorder = new StepRecorder();
  private breakpointManager = new BreakpointManager();

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

  /** 设置记忆配置 */
  withMemory(config?: AgentConfig['memory']): this {
    this.memory.configure(config);
    return this;
  }

  /**
   * 注入外部 MemoryManager（用于跨请求的会话级记忆持久化）
   *
   * 使用场景：服务端维护 sessionId → MemoryManager 映射，
   * 每个请求从映射中取出对应的 MemoryManager 注入到新创建的 AgentRunner，
   * 这样 Agent 就能"记住"之前的对话。
   */
  withExternalMemory(memory: MemoryManager): this {
    this.memory = memory;
    return this;
  }

  /** 获取当前的 MemoryManager（用于在 run/runStream 结束后保存消息） */
  getMemory(): MemoryManager {
    return this.memory;
  }

  /** 注册安全护栏 */
  withGuardrails(guardrails: Guardrail[]): this {
    this.guardrails.push(...guardrails);
    return this;
  }

  /** 设置断点 */
  withBreakpoints(breakpoints: Array<{ id: string; onStepType?: string; onToolName?: string; onStepIndex?: number }>): this {
    for (const bp of breakpoints) {
      this.breakpointManager.add({
        id: bp.id,
        onStepType: bp.onStepType as 'llm_call' | 'tool_call' | 'middleware' | 'error' | undefined,
        onToolName: bp.onToolName,
        onStepIndex: bp.onStepIndex,
      });
    }
    return this;
  }

  /** 获取断点管理器 */
  getBreakpointManager(): BreakpointManager {
    return this.breakpointManager;
  }

  /** 获取步骤记录器 */
  getStepRecorder(): StepRecorder {
    return this.stepRecorder;
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
   *
   * 使用 StreamEvent 可辨识联合类型，覆盖完整的 Agent 执行流：
   * text-delta → tool-call-start → tool-call-args → tool-call-end → tool-result → ... → done
   */
  async *runStream(
    userMessage: string,
    config: Omit<AgentConfig, 'tools' | 'middleware' | 'memory'>,
  ): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const messages: AgentMessage[] = [
      { role: 'system', content: config.systemPrompt },
      ...this.memory.getHistory(),
      { role: 'user', content: userMessage },
    ];

    const toolDefs = this.tools.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.execute,
    }));

    const toolCalls: ToolCallRecord[] = [];
    const maxSteps = 20;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      yield { type: 'step-start', stepIndex };

      let fullContent = '';
      let reasoningContent = '';
      const accumulator = new StreamAccumulator();

      try {
        // 流式调用 LLM
        for await (const chunk of this.adapter.chatStream(messages, {
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        })) {
          // 文本增量
          if (chunk.content) {
            fullContent += chunk.content;
            yield { type: 'text-delta', content: chunk.content };
          }

          // DeepSeek thinking mode: reasoning_content 增量（不在前端展示，但需要传回 API）
          if (chunk.reasoningContent) {
            reasoningContent += chunk.reasoningContent;
          }

          // Tool call delta（完整或部分）
          if (chunk.toolCallDelta) {
            const tc = chunk.toolCallDelta;

            // 检测新的 tool call（通过 accumulator 检查）
            const before = accumulator.peek();
            if (tc.id && tc.name && !before.some(b => b.id === tc.id)) {
              yield { type: 'tool-call-start', id: tc.id, name: tc.name };
            }

            // 参数增量
            if (tc.id && tc.arguments && Object.keys(tc.arguments).length > 0) {
              const argsStr = JSON.stringify(tc.arguments);
              if (argsStr !== '{}') {
                yield { type: 'tool-call-args', id: tc.id, args: argsStr };
              }
            }

            // 将 delta 填入 accumulator
            // 支持两种格式：完整的 ToolCall 或 delta 格式
            accumulator.addOpenAIDelta({
              index: 0, // 简化：单 tool call 场景
              id: tc.id,
              function: tc.name ? { name: tc.name, arguments: JSON.stringify(tc.arguments) } : undefined,
            });
          }

          // Finish reason
          if (chunk.finishReason === 'tool_calls') {
            const toolCalls = accumulator.drain();
            for (const tc of toolCalls) {
              yield { type: 'tool-call-end', id: tc.id };
            }
          }
        }

        // 流结束后，drain 剩余的 tool calls
        const pendingCalls = accumulator.drain();

        if (pendingCalls.length > 0) {
          yield { type: 'step-end', stepIndex };

          // 添加 assistant 消息（含 reasoning_content 用于 DeepSeek thinking mode）
          messages.push({
            role: 'assistant',
            content: fullContent,
            toolCalls: pendingCalls,
            ...(reasoningContent && { reasoningContent }),
          });

          // 执行每个 tool call
          for (const tc of pendingCalls) {
            const toolStart = Date.now();
            try {
              const result = await this.tools.execute(tc.name, tc.arguments);
              const record: ToolCallRecord = {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                result,
                duration: Date.now() - toolStart,
              };
              toolCalls.push(record);

              yield { type: 'tool-result', id: tc.id, name: tc.name, result };

              // 添加 tool 结果消息
              messages.push({
                role: 'tool',
                content: JSON.stringify(result),
                toolCallId: tc.id,
                name: tc.name,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              const record: ToolCallRecord = {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                result: null,
                duration: Date.now() - toolStart,
                error: errorMsg,
              };
              toolCalls.push(record);

              yield { type: 'tool-result', id: tc.id, name: tc.name, result: null, error: errorMsg };

              messages.push({
                role: 'tool',
                content: `Error: ${errorMsg}`,
                toolCallId: tc.id,
                name: tc.name,
              });
            }
          }

          // 继续循环 → LLM 处理 tool 结果
          continue;
        }

        // 没有 tool calls → 最终输出
        yield { type: 'step-end', stepIndex };

        totalOutputTokens += this.estimateTokens(fullContent);

        yield {
          type: 'done',
          output: fullContent,
          tokens: {
            input: totalInputTokens,
            output: totalOutputTokens,
            total: totalInputTokens + totalOutputTokens,
          },
          toolCalls,
        };
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        yield { type: 'error', message: errorMsg };
        return;
      }
    }

    // 超出最大步数
    yield { type: 'error', message: `Agent exceeded maximum of ${maxSteps} steps` };
  }

  /** 粗略 Token 估算（英文：~4 chars/token，中文：~1.5 chars/token） */
  private estimateTokens(text: string): number {
    const latinChars = (text.match(/[a-zA-Z0-9\s]/g) || []).length;
    const otherChars = text.length - latinChars;
    return Math.ceil(latinChars / 4 + otherChars / 1.5);
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

      // Breakpoint check — before step
      const matchedBps = await this.breakpointManager.shouldBreak({
        currentStep: i,
        stepType: 'llm_call',
      });
      for (const bpId of matchedBps) {
        this.events.emit('breakpoint-hit', { bpId, step: i });
        await this.breakpointManager.waitForResume(bpId);
      }

      // Step: LLM Call — Guardrail beforeLLM
      for (const guard of this.guardrails) {
        if (guard.beforeLLM) {
          const result = await guard.beforeLLM(ctx, ctx.messages);
          if (!result.allowed) {
            return this.buildErrorResult(
              `Guard "${guard.name}" blocked LLM call: ${result.reason}`,
              traceId, startTime, steps, state.getInputTokens(), state.getOutputTokens()
            );
          }
        }
      }

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

      // Guardrail afterLLM
      for (const guard of this.guardrails) {
        if (guard.afterLLM) {
          const result = await guard.afterLLM(ctx, response.content);
          if (!result.allowed) {
            return this.buildErrorResult(
              `Guard "${guard.name}" rejected LLM response: ${result.reason}`,
              traceId, startTime, steps, state.getInputTokens(), state.getOutputTokens()
            );
          }
        }
      }

      this.events.emit('step', { stepIndex: i, type: 'llm', content: response.content });

      // 记录步骤
      this.stepRecorder.record({
        stepIndex: i,
        type: 'llm_call',
        name: `LLM Call #${i + 1}`,
        input: ctx.messages[ctx.messages.length - 1]?.content?.substring(0, 500),
        output: response.content?.substring(0, 500),
        startTime: llmStart,
        endTime: Date.now(),
        tokens: { input: response.usage?.inputTokens || 0, output: response.usage?.outputTokens || 0 },
        messageSnapshot: ctx.messages.slice(-6).map(m => ({ role: m.role, content: m.content?.substring(0, 200) ?? '' })),
      });

      // 添加 assistant 消息（含 reasoning_content 用于 DeepSeek thinking mode）
      ctx.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls?.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
        ...(response.reasoningContent && { reasoningContent: response.reasoningContent }),
      });

      // 检查是否需要执行工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          // Breakpoint check — before tool
          const matchedToolBps = await this.breakpointManager.shouldBreak({
            currentStep: i,
            stepType: 'tool_call',
            toolName: tc.name,
          });
          for (const bpId of matchedToolBps) {
            this.events.emit('breakpoint-hit', { bpId, step: i, tool: tc.name });
            await this.breakpointManager.waitForResume(bpId);
          }

          // Guardrail beforeTool
          let toolBlocked = false;
          for (const guard of this.guardrails) {
            if (guard.beforeTool) {
              const result = await guard.beforeTool(ctx, tc.name, tc.arguments);
              if (!result.allowed) {
                const toolRecord: ToolCallRecord = {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                  result: null,
                  duration: 0,
                  error: result.reason,
                };
                toolCalls.push(toolRecord);
                ctx.messages.push({
                  role: 'tool',
                  content: `Tool blocked by guard "${guard.name}": ${result.reason}`,
                  toolCallId: tc.id,
                  name: tc.name,
                });
                this.events.emit('tool-call-blocked', { tool: tc.name, guard: guard.name, reason: result.reason });
                toolBlocked = true;
                break;
              }
            }
          }
          if (toolBlocked) continue;

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

            // Guardrail afterTool
            for (const guard of this.guardrails) {
              if (guard.afterTool) {
                const guardResult = await guard.afterTool(ctx, tc.name, result);
                if (!guardResult.allowed) {
                  const toolRecord: ToolCallRecord = {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                    result,
                    duration: Date.now() - toolStart,
                    error: `Rejected by guard "${guard.name}": ${guardResult.reason}`,
                  };
                  toolCalls.push(toolRecord);
                  this.tracer.endSpan(toolSpanId, { error: guardResult.reason }, 'error');
                  ctx.messages.push({
                    role: 'tool',
                    content: guardResult.reason || 'Tool result rejected',
                    toolCallId: tc.id,
                    name: tc.name,
                  });
                  continue;
                }
              }
            }

            this.events.emit('tool-call', toolRecord);

            // 记录工具调用步骤
            this.stepRecorder.record({
              stepIndex: i,
              type: 'tool_call',
              name: `Tool: ${tc.name}`,
              input: tc.arguments,
              output: typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result).substring(0, 500),
              startTime: toolStart,
              endTime: Date.now(),
            });

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

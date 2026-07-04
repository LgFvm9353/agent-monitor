/**
 * @agent-harness/core
 *
 * Agent Harness 引擎 —— AI Agent 的可观测性与控制层
 *
 * 提供 Agent 开发所需的全部基础设施：
 * - AgentRunner: Agent 执行引擎（思考→行动→观察循环）
 * - ToolRegistry: 工具注册中心（MCP 集成）
 * - MiddlewarePipeline: 中间件管道（洋葱模型）
 * - MemoryManager: 记忆管理（对话历史 + 摘要）
 * - EvalRunner: 评估框架（数据集 + 多维度评分）
 * - Tracer: Agent 执行追踪
 * - ModelAdapter: 模型适配器（OpenAI / Anthropic）
 * - Guardrails: 安全护栏（内容过滤 / 工具沙箱 / 预算控制）
 * - StreamAccumulator: 流式工具调用累积器
 * - StepRecorder: 步骤记录与回放
 * - BreakpointManager: 断点调试管理
 *
 * @example
 * ```ts
 * import { AgentRunner, createOpenAIAdapter, ToolRegistry } from '@agent-harness/core';
 *
 * const runner = new AgentRunner(createOpenAIAdapter({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   modelId: 'gpt-4o',
 * }));
 *
 * runner.withTools({
 *   search: { execute: async (args) => { ... }, description: '...', parameters: {...} },
 * });
 *
 * const result = await runner.run('帮我分析这段代码', {
 *   model: 'gpt-4o',
 *   systemPrompt: '你是一个代码分析专家...',
 * });
 *
 * console.log(result.output);
 * ```
 *
 * @example
 * ```ts
 * // 流式执行
 * for await (const event of runner.runStream('...', config)) {
 *   if (event.type === 'text-delta') console.log(event.content);
 *   if (event.type === 'done') console.log('Done:', event.output);
 * }
 * ```
 *
 * @example
 * ```ts
 * // 安全护栏
 * import { createContentFilterGuard, createBudgetGuard } from '@agent-harness/core';
 *
 * runner.withGuardrails([
 *   createContentFilterGuard(),
 *   createBudgetGuard({ maxTokens: 50_000 }),
 * ]);
 * ```
 */

// Agent
export { AgentRunner } from './agent/runner';
export {
  createOpenAIAdapter,
  createAnthropicAdapter,
  StreamAccumulator,
} from './agent/adapter';
export type {
  ModelAdapter,
  ModelOptions,
  ModelResponse,
  ModelStreamChunk,
  AgentMessage,
  ToolCall,
  AgentResult,
  AgentStep,
  ToolCallRecord,
  RunContext,
  StreamEvent,
} from './agent/types';

// Tool
export { ToolRegistry } from './tool/registry';

// Middleware
export {
  MiddlewarePipeline,
  createContextInjector,
  createOutputValidator,
  createCostTracker,
} from './middleware/pipeline';
export type { MiddlewareDefinition } from './middleware/pipeline';

// Memory
export { MemoryManager } from './memory/manager';

// Eval
export { EvalRunner, DatasetManager } from './eval/runner';
export type { ScorerFunction } from './eval/runner';

// Trace
export {
  Tracer,
  createTracer,
  getGlobalTracer,
  StepRecorder,
  BreakpointManager,
} from './trace/tracer';
export type { StepRecord, Breakpoint } from './trace/tracer';

// Guardrails
export { createContentFilterGuard } from './guardrail/content-filter';
export type { ContentFilterConfig } from './guardrail/content-filter';
export { createToolSandboxGuard } from './guardrail/tool-sandbox';
export type { ToolSandboxConfig } from './guardrail/tool-sandbox';
export { createBudgetGuard, MODEL_PRICING } from './guardrail/budget-guard';
export type { BudgetConfig, TokenPricing } from './guardrail/budget-guard';
export type { Guardrail, GuardResult } from './guardrail/types';

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
 * - Tracer: Agent 执行追踪（OpenTelemetry 兼容）
 * - ModelAdapter: 模型适配器（OpenAI / Anthropic）
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
 */

// Agent
export { AgentRunner } from './agent/runner';
export { createOpenAIAdapter, createAnthropicAdapter } from './agent/adapter';
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
export { createTracer, getGlobalTracer } from './trace/tracer';

/**
 * Agent Runner 类型定义
 *
 * 定义了 Agent 执行的核心抽象：
 * - Model Adapter: 统一不同 LLM 提供商的接口
 * - Agent Message: 对话消息格式
 * - Agent Result: 执行结果
 */

import type { AgentConfig, ToolDefinition } from '../types';

// ===== Model Adapter =====

/** 模型适配器接口 — 统一 OpenAI/Anthropic/DeepSeek 等不同提供商的调用方式 */
export interface ModelAdapter {
  /** 模型标识 */
  modelId: string;
  /** 提供商 */
  provider: string;
  /** 同步调用（非流式） */
  chat(messages: AgentMessage[], options?: ModelOptions): Promise<ModelResponse>;
  /** 流式调用 */
  chatStream(messages: AgentMessage[], options?: ModelOptions): AsyncGenerator<ModelStreamChunk>;
  /** Token 计数 */
  countTokens?(messages: AgentMessage[]): number;
}

/** 模型调用选项 */
export interface ModelOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stop?: string[];
  /** 启用 JSON 模式 */
  jsonMode?: boolean;
}

/** 模型响应 */
export interface ModelResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** 流式响应块 */
export interface ModelStreamChunk {
  content?: string;
  toolCallDelta?: Partial<ToolCall>;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

// ===== Agent Messages =====

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

// ===== Tool Calls =====

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ===== Agent Execution =====

/** Agent 执行结果 */
export interface AgentResult {
  /** 最终的文本输出 */
  output: string;
  /** 工具调用历史 */
  toolCalls: ToolCallRecord[];
  /** Token 消耗 */
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  /** 执行耗时 (ms) */
  duration: number;
  /** 执行步骤数（每轮 LLM 调用算一步） */
  steps: AgentStep[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** Trace ID */
  traceId: string;
}

/** 工具调用记录 */
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  duration: number;
  error?: string;
}

/** Agent 执行步骤 */
export interface AgentStep {
  stepIndex: number;
  type: 'llm_call' | 'tool_call' | 'middleware';
  name: string;
  input?: unknown;
  output?: unknown;
  startTime: number;
  endTime: number;
  tokens?: { input: number; output: number };
}

// ===== Agent Run Context =====

/** Agent 运行时上下文 */
export interface RunContext {
  /** 配置 */
  config: AgentConfig;
  /** 消息历史 */
  messages: AgentMessage[];
  /** 当前步骤 */
  currentStep: number;
  /** 最大步骤数（防止无限循环） */
  maxSteps: number;
  /** 工具注册中心 */
  tools: ToolRegistryLike;
  /** 添加步骤 */
  addStep: (step: AgentStep) => void;
  /** 获取运行时指标 */
  getMetrics: () => RunMetrics;
}

export interface RunMetrics {
  stepCount: number;
  toolCallCount: number;
  totalTokens: number;
  elapsedMs: number;
}

/** 工具注册中心接口（避免循环依赖） */
export interface ToolRegistryLike {
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}

// ===== Stream Events =====

/**
 * Agent 流式事件
 *
 * 可辨识联合类型，覆盖 Agent 执行过程中的所有流式事件。
 * 使用方通过 switch/case 按 type 分发处理。
 */
export type StreamEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-args'; id: string; args: string }
  | { type: 'tool-call-end'; id: string }
  | { type: 'tool-result'; id: string; name: string; result: unknown; error?: string }
  | { type: 'step-start'; stepIndex: number }
  | { type: 'step-end'; stepIndex: number }
  | { type: 'done'; output: string; tokens: { input: number; output: number; total: number }; toolCalls: ToolCallRecord[] }
  | { type: 'error'; message: string };

// ============================================================
// @agent-harness/core — 类型定义
// ============================================================

// ---------- Agent 配置 ----------

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  middleware?: MiddlewareConfig[];
  memory?: MemoryConfig;
  retry?: RetryConfig;
}

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  enableFallback?: boolean;
  fallbackModel?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MiddlewareConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface MemoryConfig {
  type: 'buffer' | 'summary' | 'vector';
  /** 对话历史 token 上限，超出时触发压缩（摘要模式），默认 4000 */
  maxTokens?: number;
  maxTurns?: number;
  /** 压缩后保留最近 N 轮完整消息（默认 maxTurns） */
  keepRecentTurns?: number;
}

// ---------- Agent Trace ----------

export interface AgentTrace {
  traceId: string;
  sessionId: string;
  rootSpan: AgentSpan;
  metadata: TraceMetadata;
}

export interface TraceMetadata {
  sessionId?: string;
  startTime: number;
  endTime: number;
  model: string;
  tokens: TokenUsage;
  success: boolean;
  error?: string;
  tags?: Record<string, string>;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheHit?: number;
  estimatedCost?: number;
}

export interface AgentSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime: number;
  input?: unknown;
  output?: unknown;
  children: AgentSpan[];
  status: SpanStatus;
  metadata?: Record<string, unknown>;
}

export type SpanType = 'agent' | 'llm' | 'tool' | 'middleware' | 'memory' | 'eval';

export interface SpanStatus {
  code: 'ok' | 'error' | 'cancelled';
  message?: string;
}

// ---------- Eval ----------

export interface EvalDataset {
  id: string;
  name: string;
  description?: string;
  items: EvalItem[];
  createdAt: number;
  updatedAt: number;
}

export interface EvalItem {
  id: string;
  input: string;
  expectedOutput?: string;
  context?: Record<string, unknown>;
  labels?: string[];
}

export interface EvalRun {
  runId: string;
  datasetId: string;
  agentConfig: AgentConfig;
  scores: EvalScore[];
  startTime: number;
  endTime: number;
  summary: EvalSummary;
}

export interface EvalScore {
  itemId: string;
  scorerName: string;
  score: number;
  passed: boolean;
  details?: string;
}

export interface EvalSummary {
  totalItems: number;
  passedItems: number;
  passRate: number;
  scorerAverages: Record<string, number>;
}

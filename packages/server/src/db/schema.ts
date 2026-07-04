/**
 * Drizzle ORM Schema — Agent Harness Monitor 数据库设计
 *
 * 表结构：
 * - traces: Agent 执行 Trace 记录
 * - trace_spans: Trace 中的 Span 数据
 * - eval_datasets: 评估数据集
 * - eval_runs: 评估运行记录
 * - monitor_events: 前端监控上报事件
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SQLJsDatabase } from 'drizzle-orm/sql-js';

/** DrizzleDB 类型（内部使用） */
export type DrizzleDB = SQLJsDatabase;

// ===== Trace 相关 =====

/** Agent 执行 Trace */
export const traces = sqliteTable('traces', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  model: text('model').notNull(),
  /** JSON string: TraceMetadata */
  metadata: text('metadata').notNull(),
  /** 执行是否成功 */
  success: integer('success', { mode: 'boolean' }).notNull().default(true),
  error: text('error'),
  /** Token 消耗 */
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  /** 预估费用 USD */
  estimatedCost: real('estimated_cost').default(0),
  /** 执行耗时 ms */
  durationMs: integer('duration_ms').notNull().default(0),
  /** 用户标签 JSON */
  tags: text('tags'),
  createdAt: integer('created_at').notNull(),
});

/** Trace Span 数据 */
export const traceSpans = sqliteTable('trace_spans', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull().references(() => traces.id),
  parentSpanId: text('parent_span_id'),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'agent' | 'llm' | 'tool' | 'middleware'
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  /** JSON: input data */
  input: text('input'),
  /** JSON: output data */
  output: text('output'),
  status: text('status').notNull().default('ok'), // 'ok' | 'error' | 'cancelled'
  statusMessage: text('status_message'),
  /** JSON: extra metadata */
  metadata: text('metadata'),
});

// ===== Eval 相关 =====

/** Eval 数据集 */
export const evalDatasets = sqliteTable('eval_datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  /** JSON: EvalItem[] */
  items: text('items').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Eval 运行记录 */
export const evalRuns = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull().references(() => evalDatasets.id),
  /** JSON: AgentConfig */
  agentConfig: text('agent_config').notNull(),
  /** JSON: EvalScore[] */
  scores: text('scores').notNull().default('[]'),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  /** 通过率 0-1 */
  passRate: real('pass_rate').notNull().default(0),
  /** JSON: scorer averages */
  scorerAverages: text('scorer_averages').default('{}'),
});

// ===== 前端监控事件 =====

/** 前端监控上报事件 */
export const monitorEvents = sqliteTable('monitor_events', {
  id: text('id').primaryKey(),
  /** 应用 ID */
  appId: text('app_id').notNull(),
  /** 事件类型 */
  type: text('type').notNull(), // 'error' | 'performance' | 'behavior' | 'custom'
  /** JSON: 事件数据 */
  data: text('data').notNull(),
  /** 页面 URL */
  url: text('url'),
  /** 会话 ID */
  sessionId: text('session_id'),
  /** User Agent */
  userAgent: text('user_agent'),
  /** SDK 版本 */
  sdkVersion: text('sdk_version'),
  /** 时间戳 */
  timestamp: integer('timestamp').notNull(),
  /** 接收时间 */
  receivedAt: integer('received_at').notNull(),
});

// ===== Agent 配置 =====

/** Agent 配置管理 */
export const agentConfigs = sqliteTable('agent_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** JSON: AgentConfig */
  config: text('config').notNull(),
  /** 是否激活 */
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Drizzle ORM Schema — Agent Harness Monitor 数据库设计 (MySQL)
 *
 * 表结构：
 * - traces: Agent 执行 Trace 记录
 * - trace_spans: Trace 中的 Span 数据
 * - runtime_events: Agent 运行时事件明细
 * - eval_datasets: 评估数据集
 * - eval_runs: 评估运行记录
 * - monitor_events: 前端监控上报事件
 * - agent_configs: Agent 配置管理
 */

import { mysqlTable, varchar, text, mediumtext, int, bigint, boolean, double, index } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/** DrizzleDB 类型（内部使用） */
export type DrizzleDB = MySql2Database<typeof schema>;

// ===== Trace 相关 =====

/** Agent 执行 Trace */
export const traces = mysqlTable('traces', {
  id: varchar('id', { length: 64 }).primaryKey(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  /** JSON string: TraceMetadata */
  metadata: text('metadata').notNull(),
  /** 执行是否成功 */
  success: boolean('success').notNull().default(true),
  error: text('error'),
  /** Token 消耗 */
  inputTokens: int('input_tokens').notNull().default(0),
  outputTokens: int('output_tokens').notNull().default(0),
  /** 预估费用 USD */
  estimatedCost: double('estimated_cost').default(0),
  /** 执行耗时 ms */
  durationMs: int('duration_ms').notNull().default(0),
  /** 用户标签 JSON */
  tags: text('tags'),
  /** 时间戳 (ms) */
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/** Trace Span 数据 */
export const traceSpans = mysqlTable('trace_spans', {
  id: varchar('id', { length: 64 }).primaryKey(),
  traceId: varchar('trace_id', { length: 64 }).notNull(),
  parentSpanId: varchar('parent_span_id', { length: 64 }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(), // 'agent' | 'llm' | 'tool' | 'middleware'
  startTime: bigint('start_time', { mode: 'number' }).notNull(),
  endTime: bigint('end_time', { mode: 'number' }).notNull(),
  /** JSON: input data */
  input: text('input'),
  /** JSON: output data */
  output: text('output'),
  status: varchar('status', { length: 16 }).notNull().default('ok'), // 'ok' | 'error' | 'cancelled'
  statusMessage: text('status_message'),
  /** JSON: extra metadata */
  metadata: text('metadata'),
}, (table) => ({
  traceIdIdx: index('idx_trace_spans_trace_id').on(table.traceId),
}));

/** Agent 运行时事件明细 */
export const runtimeEvents = mysqlTable('runtime_events', {
  id: varchar('id', { length: 64 }).primaryKey(),
  traceId: varchar('trace_id', { length: 64 }).notNull(),
  runId: varchar('run_id', { length: 64 }).notNull(),
  parentId: varchar('parent_id', { length: 64 }),
  stepId: varchar('step_id', { length: 64 }),
  kind: varchar('kind', { length: 32 }).notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  startTime: bigint('start_time', { mode: 'number' }).notNull(),
  endTime: bigint('end_time', { mode: 'number' }),
  durationMs: int('duration_ms'),
  input: mediumtext('input'),
  outputSummary: mediumtext('output_summary'),
  error: text('error'),
  metadata: mediumtext('metadata'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  traceIdIdx: index('idx_runtime_events_trace_id').on(table.traceId),
  runIdIdx: index('idx_runtime_events_run_id').on(table.runId),
  kindIdx: index('idx_runtime_events_kind').on(table.kind),
  eventTypeIdx: index('idx_runtime_events_event_type').on(table.eventType),
  statusIdx: index('idx_runtime_events_status').on(table.status),
  startTimeIdx: index('idx_runtime_events_start_time').on(table.startTime),
}));

// ===== Eval 相关 =====

/** Eval 数据集 */
export const evalDatasets = mysqlTable('eval_datasets', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  /** JSON: EvalItem[] */
  items: mediumtext('items').notNull().default('[]'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Eval 运行记录 */
export const evalRuns = mysqlTable('eval_runs', {
  id: varchar('id', { length: 64 }).primaryKey(),
  datasetId: varchar('dataset_id', { length: 64 }).notNull(),
  /** JSON: AgentConfig */
  agentConfig: text('agent_config').notNull(),
  /** JSON: EvalScore[] */
  scores: mediumtext('scores').notNull().default('[]'),
  startTime: bigint('start_time', { mode: 'number' }).notNull(),
  endTime: bigint('end_time', { mode: 'number' }).notNull(),
  /** 通过率 0-1 */
  passRate: double('pass_rate').notNull().default(0),
  /** JSON: scorer averages */
  scorerAverages: text('scorer_averages').default('{}'),
}, (table) => ({
  datasetIdIdx: index('idx_eval_runs_dataset_id').on(table.datasetId),
}));

// ===== 前端监控事件 =====

/** 前端监控上报事件 */
export const monitorEvents = mysqlTable('monitor_events', {
  id: varchar('id', { length: 64 }).primaryKey(),
  /** 应用 ID */
  appId: varchar('app_id', { length: 128 }).notNull(),
  /** 事件类型 */
  type: varchar('type', { length: 32 }).notNull(), // 'error' | 'performance' | 'behavior' | 'custom'
  /** JSON: 事件数据 */
  data: mediumtext('data').notNull(),
  /** 页面 URL */
  url: text('url'),
  /** 会话 ID */
  sessionId: varchar('session_id', { length: 64 }),
  /** User Agent */
  userAgent: text('user_agent'),
  /** SDK 版本 */
  sdkVersion: varchar('sdk_version', { length: 32 }),
  /** 时间戳 (ms) */
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  /** 接收时间 (ms) */
  receivedAt: bigint('received_at', { mode: 'number' }).notNull(),
}, (table) => ({
  appIdIdx: index('idx_monitor_events_app_id').on(table.appId),
  typeIdx: index('idx_monitor_events_type').on(table.type),
  timestampIdx: index('idx_monitor_events_timestamp').on(table.timestamp),
}));

// ===== Agent 配置 =====

/** Agent 配置管理 */
export const agentConfigs = mysqlTable('agent_configs', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  /** JSON: AgentConfig */
  config: text('config').notNull(),
  /** 是否激活 */
  active: boolean('active').notNull().default(true),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** 所有表（用于 Drizzle 类型推导） */
export const schema = {
  traces,
  traceSpans,
  runtimeEvents,
  evalDatasets,
  evalRuns,
  monitorEvents,
  agentConfigs,
};

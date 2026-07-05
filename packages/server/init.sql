-- ============================================================
-- Agent Harness Monitor — MySQL 初始化脚本
-- ============================================================
-- 使用方法：
--   mysql -u root -p < init.sql
--   或在 MySQL 客户端中 source init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS agent_harness_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE agent_harness_monitor;

-- ===== Trace 相关 =====

-- Agent 执行 Trace 记录
CREATE TABLE IF NOT EXISTS traces (
  id            VARCHAR(64)  PRIMARY KEY,
  session_id    VARCHAR(64)  NOT NULL,
  model         VARCHAR(128) NOT NULL,
  metadata      TEXT         NOT NULL,               -- JSON: TraceMetadata
  success       TINYINT(1)   NOT NULL DEFAULT 1,     -- 执行是否成功
  error         TEXT         NULL,
  input_tokens  INT          NOT NULL DEFAULT 0,     -- 输入 Token 数
  output_tokens INT          NOT NULL DEFAULT 0,     -- 输出 Token 数
  estimated_cost DOUBLE      NULL     DEFAULT 0,     -- 预估费用 (USD)
  duration_ms   INT          NOT NULL DEFAULT 0,     -- 执行耗时 (ms)
  tags          TEXT         NULL,                   -- JSON: 用户标签
  created_at    BIGINT       NOT NULL                -- 时间戳 (ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trace Span 数据
CREATE TABLE IF NOT EXISTS trace_spans (
  id             VARCHAR(64)  PRIMARY KEY,
  trace_id       VARCHAR(64)  NOT NULL,              -- FK → traces.id
  parent_span_id VARCHAR(64)  NULL,
  name           VARCHAR(255) NOT NULL,
  type           VARCHAR(32)  NOT NULL,              -- agent | llm | tool | middleware
  start_time     BIGINT       NOT NULL,
  end_time       BIGINT       NOT NULL,
  input          TEXT         NULL,                  -- JSON
  output         TEXT         NULL,                  -- JSON
  status         VARCHAR(16)  NOT NULL DEFAULT 'ok', -- ok | error | cancelled
  status_message TEXT         NULL,
  metadata       TEXT         NULL,                  -- JSON

  INDEX idx_trace_spans_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Eval 相关 =====

-- Eval 数据集
CREATE TABLE IF NOT EXISTS eval_datasets (
  id          VARCHAR(64)  PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  items       MEDIUMTEXT   NOT NULL DEFAULT ('[]'),  -- JSON: EvalItem[]
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eval 运行记录
CREATE TABLE IF NOT EXISTS eval_runs (
  id              VARCHAR(64)  PRIMARY KEY,
  dataset_id      VARCHAR(64)  NOT NULL,             -- FK → eval_datasets.id
  agent_config    TEXT         NOT NULL,             -- JSON: AgentConfig
  scores          MEDIUMTEXT   NOT NULL DEFAULT ('[]'),-- JSON: EvalScore[]
  start_time      BIGINT       NOT NULL,
  end_time        BIGINT       NOT NULL,
  pass_rate       DOUBLE       NOT NULL DEFAULT 0,   -- 通过率 0~1
  scorer_averages TEXT         NULL     DEFAULT ('{}'),-- JSON

  INDEX idx_eval_runs_dataset_id (dataset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== 前端监控事件 =====

-- 前端监控上报事件
CREATE TABLE IF NOT EXISTS monitor_events (
  id          VARCHAR(64)  PRIMARY KEY,
  app_id      VARCHAR(128) NOT NULL,                 -- 应用 ID
  type        VARCHAR(32)  NOT NULL,                 -- error | performance | behavior | custom
  data        MEDIUMTEXT   NOT NULL,                 -- JSON: 事件数据
  url         TEXT         NULL,                     -- 页面 URL
  session_id  VARCHAR(64)  NULL,                     -- 会话 ID
  user_agent  TEXT         NULL,                     -- User Agent
  sdk_version VARCHAR(32)  NULL,                     -- SDK 版本
  timestamp   BIGINT       NOT NULL,                 -- 事件时间戳 (ms)
  received_at BIGINT       NOT NULL,                 -- 接收时间 (ms)

  INDEX idx_monitor_events_app_id (app_id),
  INDEX idx_monitor_events_type (type),
  INDEX idx_monitor_events_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Agent 配置 =====

-- Agent 配置管理
CREATE TABLE IF NOT EXISTS agent_configs (
  id         VARCHAR(64)  PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  config     TEXT         NOT NULL,                  -- JSON: AgentConfig
  active     TINYINT(1)   NOT NULL DEFAULT 1,       -- 是否激活
  created_at BIGINT       NOT NULL,
  updated_at BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/**
 * Drizzle ORM Module — 数据库连接管理
 *
 * 使用 sql.js（SQLite 的 WASM 实现），无需原生编译依赖。
 * 跨平台兼容：Windows / macOS / Linux 均可直接运行。
 */
import { Module, Global } from '@nestjs/common';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from './schema';

export const DB_TOKEN = 'DRIZZLE_DB';

const DB_FILE = path.resolve('agent-harness-monitor.db');

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: async () => {
        const SQL = await initSqlJs();
        let sqlDb: SqlJsDatabase;

        if (fs.existsSync(DB_FILE)) {
          const buffer = fs.readFileSync(DB_FILE);
          sqlDb = new SQL.Database(buffer);
        } else {
          sqlDb = new SQL.Database();
        }

        // 创建表结构（sql.js 的 drizzle 不自动建表，需要手动执行）
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS traces (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model TEXT NOT NULL,
            metadata TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 1,
            error TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost REAL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0, tags TEXT, created_at INTEGER NOT NULL
          )
        `);
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS trace_spans (
            id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
            name TEXT NOT NULL, type TEXT NOT NULL, start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL, input TEXT, output TEXT,
            status TEXT NOT NULL DEFAULT 'ok', status_message TEXT, metadata TEXT
          )
        `);
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS eval_datasets (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
            items TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS eval_runs (
            id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, agent_config TEXT NOT NULL,
            scores TEXT NOT NULL DEFAULT '[]', start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL, pass_rate REAL NOT NULL DEFAULT 0,
            scorer_averages TEXT DEFAULT '{}'
          )
        `);
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS monitor_events (
            id TEXT PRIMARY KEY, app_id TEXT NOT NULL, type TEXT NOT NULL,
            data TEXT NOT NULL, url TEXT, session_id TEXT, user_agent TEXT,
            sdk_version TEXT, timestamp INTEGER NOT NULL, received_at INTEGER NOT NULL
          )
        `);
        sqlDb.run(`
          CREATE TABLE IF NOT EXISTS agent_configs (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);

        return drizzle(sqlDb, { schema });
      },
    },
  ],
  exports: [DB_TOKEN],
})
export class DrizzleModule {}

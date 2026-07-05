/**
 * Drizzle ORM Module — MySQL 数据库连接管理
 *
 * 使用 mysql2 驱动连接本地 MySQL 8.0。
 * 建库建表请先执行：mysql -u root -p < init.sql
 */
import { Module, Global } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

export const DB_TOKEN = 'DRIZZLE_DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: async () => {
        const host = process.env.DB_HOST || 'localhost';
        const port = parseInt(process.env.DB_PORT || '3306', 10);
        const user = process.env.DB_USER || 'root';
        const password = process.env.DB_PASSWORD || '';
        const database = process.env.DB_NAME || 'agent_harness_monitor';

        const pool = createPool({ host, port, user, password, database });
        const db = drizzle(pool, { schema, mode: 'default' });
        return db;
      },
    },
  ],
  exports: [DB_TOKEN],
})
export class DrizzleModule {}

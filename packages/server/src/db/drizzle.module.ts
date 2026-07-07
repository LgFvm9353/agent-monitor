/**
 * Drizzle ORM Module — MySQL 数据库连接管理
 *
 * 使用 mysql2 驱动连接本地 MySQL 8.0。
 * 建库建表请先执行：mysql -u root -p < init.sql
 */
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

export const DB_TOKEN = 'DRIZZLE_DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: async (configService: ConfigService) => {
        const host = configService.get<string>('database.host', 'localhost');
        const port = configService.get<number>('database.port', 3306);
        const user = configService.get<string>('database.user', 'root');
        const password = configService.get<string>('database.password', '');
        const database = configService.get<string>('database.name', 'agent_harness_monitor');

        const pool = createPool({ host, port, user, password, database });
        const db = drizzle(pool, { schema, mode: 'default' });
        return db;
      },
      inject: [ConfigService],
    },
  ],
  exports: [DB_TOKEN],
})
export class DrizzleModule {}

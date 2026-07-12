/**
 * 环境变量配置工厂
 *
 * 集中管理所有环境变量，提供类型安全和默认值。
 * 接入 @nestjs/config，各模块通过 ConfigService 获取配置。
 */
export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'agent_harness_monitor',
  },

  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || '',
  },
});

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import envConfig from './env.config';

/**
 * 全局配置模块
 *
 * 封装 @nestjs/config 的 ConfigModule.forRoot()，
 * 设为 @Global() 使 ConfigService 在整个应用中可用。
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [envConfig],
      envFilePath: ['.env'],
    }),
  ],
})
export class AppConfigModule {}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS 配置（允许 Dashboard 跨域访问）
  app.enableCors({
    origin: [/^https?:\/\/localhost(:\d+)?$/, 'http://127.0.0.1:5500', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  // 全局前缀
  app.setGlobalPrefix('api', {
    exclude: [], // socket.io WebSocket 不需要前缀
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Agent Harness Monitor Server running on http://localhost:${port}`);
  console.log(`📡 WebSocket: ws://localhost:${port}/trace`);
  console.log(`📊 API: http://localhost:${port}/api`);
}
bootstrap();

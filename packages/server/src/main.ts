import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppValidationPipe } from './common/pipe/validation.pipe';
import { HttpExceptionFilter } from './common/filter/exception.filter';

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

  // 全局管道/过滤器
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger API 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agent Harness Monitor API')
    .setDescription('AI Agent 前端可观测性与 Harness 控制平台 API')
    .setVersion('0.1.0')
    .addTag('agent', 'Agent 对话 & 配置')
    .addTag('traces', 'Trace 查询 & 统计')
    .addTag('eval', 'Eval 数据集 & 运行记录')
    .addTag('monitor', '前端监控事件')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3001);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Server running on http://localhost:${port}`);
  logger.log(`📡 WebSocket: ws://localhost:${port}/trace`);
  logger.log(`📊 API: http://localhost:${port}/api`);
  logger.log(`📖 Swagger: http://localhost:${port}/api/docs`);
}
bootstrap();

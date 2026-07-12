import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { DrizzleModule } from './db/drizzle.module';
import { TraceModule } from './modules/trace/trace.module';
import { AgentModule } from './modules/agent/agent.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';

@Module({
  imports: [
    AppConfigModule,
    DrizzleModule,
    TraceModule,
    AgentModule,
    MonitorModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}

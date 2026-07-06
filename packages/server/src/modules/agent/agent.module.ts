import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { MonitorModule } from '../monitor/monitor.module';
import { TraceModule } from '../trace/trace.module';

@Module({
  imports: [MonitorModule, TraceModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

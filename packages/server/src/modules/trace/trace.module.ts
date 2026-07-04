import { Module } from '@nestjs/common';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
import { TraceGateway } from './trace.gateway';

@Module({
  controllers: [TraceController],
  providers: [TraceService, TraceGateway],
  exports: [TraceService, TraceGateway],
})
export class TraceModule {}

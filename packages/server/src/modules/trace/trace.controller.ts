import { Controller, Get, Param, Query } from '@nestjs/common';
import { TraceService } from './trace.service';

@Controller('traces')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Get()
  async listTraces(
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ) {
    return this.traceService.listTraces(Number(limit), Number(offset));
  }

  @Get('stats')
  async getStats() {
    return this.traceService.getStats();
  }

  @Get(':id')
  async getTrace(@Param('id') id: string) {
    const result = await this.traceService.getTraceWithSpans(id);
    if (!result) {
      return { error: 'Trace not found', id };
    }
    return result;
  }
}

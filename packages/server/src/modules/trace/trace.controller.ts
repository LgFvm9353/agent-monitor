import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { TraceService } from './trace.service';

@ApiTags('traces')
@Controller('traces')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Get()
  @ApiOperation({ summary: '列出 Trace 记录' })
  @ApiQuery({ name: 'limit', required: false, description: '返回条数（默认 50）' })
  @ApiQuery({ name: 'offset', required: false, description: '偏移量（默认 0）' })
  async listTraces(
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ) {
    return this.traceService.listTraces(Number(limit), Number(offset));
  }

  @Get('stats')
  @ApiOperation({ summary: 'Trace 统计概览' })
  async getStats() {
    return this.traceService.getStats();
  }

  @Get('runtime-events/stats')
  @ApiOperation({ summary: '运行时事件统计概览' })
  async getRuntimeEventStats() {
    return this.traceService.getRuntimeEventStats();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个 Trace 及其所有 Span' })
  @ApiParam({ name: 'id', description: 'Trace ID' })
  async getTrace(@Param('id') id: string) {
    const result = await this.traceService.getTraceWithSpans(id);
    if (!result) {
      throw new NotFoundException('Trace not found');
    }
    return result;
  }

  @Get(':id/runtime-events')
  @ApiOperation({ summary: '获取单个 Trace 的运行时事件明细' })
  @ApiParam({ name: 'id', description: 'Trace ID' })
  async getRuntimeEvents(@Param('id') id: string) {
    const result = await this.traceService.getRuntimeEvents(id);
    return { traceId: id, events: result };
  }

  @Get(':id/run-detail')
  @ApiOperation({ summary: '获取单个 Trace 的运行详情（Trace + Runtime Events）' })
  @ApiParam({ name: 'id', description: 'Trace ID' })
  async getRunDetail(@Param('id') id: string) {
    const result = await this.traceService.getRunDetail(id);
    if (!result) {
      throw new NotFoundException('Trace not found');
    }
    return result;
  }
}

import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiQuery } from '@nestjs/swagger';
import { MonitorService } from './monitor.service';
import { ReportDto, ListEventsDto } from '../../common/dto';

@ApiTags('monitor')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  /** SDK 数据上报接口 */
  @Post('report')
  @ApiOperation({ summary: 'SDK 批量数据上报', description: '接收前端 Monitor SDK 上报的事件数组，支持去重' })
  @ApiBody({ type: ReportDto })
  async report(@Body() events: ReportDto) {
    return this.monitorService.ingestEvents(events as unknown as Array<{
      eventId: string;
      type: string;
      data: unknown;
      meta: Record<string, unknown>;
      timestamp: number;
    }>);
  }

  /** 查询事件（可按 appId + type 过滤） */
  @Get('events')
  @ApiOperation({ summary: '查询监控事件' })
  @ApiQuery({ name: 'appId', required: false, description: '应用 ID' })
  @ApiQuery({ name: 'type', required: false, description: '事件类型（error/performance/behavior/custom）' })
  @ApiQuery({ name: 'limit', required: false, description: '返回条数（1-500，默认 100）' })
  @ApiQuery({ name: 'offset', required: false, description: '偏移量（默认 0）' })
  async listEvents(@Query() query: ListEventsDto) {
    return this.monitorService.listEvents(
      query.appId,
      query.type,
      query.limit ?? 100,
      query.offset ?? 0,
    );
  }

  /** 事件统计（可按 appId 过滤） */
  @Get('stats')
  @ApiOperation({ summary: '事件统计概览' })
  @ApiQuery({ name: 'appId', required: false, description: '应用 ID' })
  async getStats(@Query('appId') appId?: string) {
    return this.monitorService.getEventStats(appId);
  }
}

import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { MonitorService } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  /** SDK 数据上报接口 */
  @Post('report')
  async report(@Body() events: Array<{
    eventId: string;
    type: string;
    data: unknown;
    meta: Record<string, unknown>;
    timestamp: number;
  }>) {
    return this.monitorService.ingestEvents(events);
  }

  /** 查询事件（可按 appId + type 过滤） */
  @Get('events')
  async listEvents(
    @Query('appId') appId?: string,
    @Query('type') type?: string,
    @Query('limit') limit = 100,
    @Query('offset') offset = 0,
  ) {
    return this.monitorService.listEvents(appId, type, Number(limit), Number(offset));
  }

  /** 事件统计（可按 appId 过滤） */
  @Get('stats')
  async getStats(@Query('appId') appId?: string) {
    return this.monitorService.getEventStats(appId);
  }
}

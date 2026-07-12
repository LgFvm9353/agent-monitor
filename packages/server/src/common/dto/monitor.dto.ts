import { ApiProperty } from '@nestjs/swagger';
import type { DtoClass } from './agent.dto';

/** 单个监控事件 */
export interface ReportEvent {
  eventId: string;
  type: string;
  data: unknown;
  meta: Record<string, unknown>;
  timestamp: number;
}

const VALID_EVENT_TYPES = ['error', 'performance', 'behavior', 'custom', 'sse', 'runtime'];

/** SDK 批量上报请求 */
export class ReportDto {
  @ApiProperty({
    description: '上报事件数组',
    example: [{ eventId: 'evt-001', type: 'error', data: {}, meta: { appId: 'my-app' }, timestamp: 1700000000000 }],
  })
  events!: ReportEvent[];

  static validate(dto: unknown): string | null {
    if (!dto || !Array.isArray(dto)) {
      return 'Request body must be an array of events';
    }
    if (dto.length === 0) return 'Events array must not be empty';
    for (let i = 0; i < dto.length; i++) {
      const evt = dto[i] as Record<string, unknown>;
      if (!evt.eventId || typeof evt.eventId !== 'string') {
        return `events[${i}].eventId is required and must be a string`;
      }
      if (!evt.type || typeof evt.type !== 'string') {
        return `events[${i}].type is required and must be a string`;
      }
      if (!VALID_EVENT_TYPES.includes(evt.type)) {
        return `events[${i}].type must be one of: ${VALID_EVENT_TYPES.join(', ')}`;
      }
      if (typeof evt.timestamp !== 'number') {
        return `events[${i}].timestamp is required and must be a number`;
      }
    }
    return null;
  }
}

/** 查询监控事件 */
export class ListEventsDto {
  @ApiProperty({ description: '应用 ID', required: false })
  appId?: string;

  @ApiProperty({ description: '事件类型', required: false, enum: VALID_EVENT_TYPES })
  type?: string;

  @ApiProperty({ description: '返回条数（1-500）', required: false, example: 100 })
  limit?: number;

  @ApiProperty({ description: '偏移量', required: false, example: 0 })
  offset?: number;

  static validate(dto: unknown): string | null {
    if (dto === undefined || dto === null) return null;
    if (typeof dto !== 'object') return 'Query params must be an object';
    const q = dto as Record<string, unknown>;
    if (q.limit !== undefined) {
      const n = Number(q.limit);
      if (isNaN(n) || n < 1 || n > 500) return 'limit must be between 1 and 500';
      q.limit = n;
    }
    if (q.offset !== undefined) {
      const n = Number(q.offset);
      if (isNaN(n) || n < 0) return 'offset must be a non-negative number';
      q.offset = n;
    }
    return null;
  }
}

/**
 * Agent 监控数据工具 — 让 Agent 能查询 monitor_events 表中的前端监控数据
 */
import type { MonitorService } from '../../monitor/monitor.service';

export type ToolDef = {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * 创建 queryMonitorEvents 工具
 *
 * Agent 可查询前端 SDK 上报的监控事件，支持按类型、应用、时间范围过滤。
 */
export function createQueryMonitorEventsTool(monitorService: MonitorService): ToolDef {
  return {
    description:
      '查询前端监控上报的事件数据。可按事件类型(error/performance/behavior/custom)、' +
      '应用ID、时间范围过滤。返回事件列表，每条包含类型、数据内容、URL、时间戳等字段。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['error', 'performance', 'behavior', 'custom'],
          description: '事件类型过滤',
        },
        appId: {
          type: 'string',
          description: '应用 ID 过滤（可选）',
        },
        startTime: {
          type: 'number',
          description: '开始时间戳(ms)，用于时间范围过滤（可选）',
        },
        endTime: {
          type: 'number',
          description: '结束时间戳(ms)，用于时间范围过滤（可选）',
        },
        limit: {
          type: 'number',
          description: '返回数量上限，默认 20，最大 100',
          default: 20,
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const type = args.type as string | undefined;
      const appId = args.appId as string | undefined;
      const limit = Math.min((args.limit as number) || 20, 100);

      const events = await monitorService.listEvents(appId, type, limit, 0);

      return {
        total: events.length,
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          appId: e.appId,
          url: e.url,
          timestamp: e.timestamp,
          data: safeJsonParse(e.data),
        })),
      };
    },
  };
}

/**
 * 创建 getMonitorStats 工具
 *
 * Agent 可获取监控数据的统计概览：总事件数、按类型分布、错误率等。
 */
export function createGetMonitorStatsTool(monitorService: MonitorService): ToolDef {
  return {
    description:
      '获取前端监控数据的统计信息。返回总事件数、按类型(error/performance/behavior/custom)的分布、' +
      '最近事件时间等。用于快速了解应用健康状态。',
    parameters: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: '应用 ID 过滤（可选，不传则统计全部）',
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const appId = args.appId as string | undefined;
      const stats = await monitorService.getEventStats(appId);

      // 额外：获取最近 5 条错误事件
      const recentErrors = await monitorService.listEvents(appId, 'error', 5, 0);

      return {
        ...stats,
        recentErrors: recentErrors.map((e) => ({
          id: e.id,
          url: e.url,
          timestamp: e.timestamp,
          data: safeJsonParse(e.data),
        })),
      };
    },
  };
}

/** 安全解析 JSON，失败时返回原始字符串 */
function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

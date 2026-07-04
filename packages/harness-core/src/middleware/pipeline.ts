/**
 * Middleware Pipeline — Agent 中间件管道
 *
 * 采用洋葱模型（类比 Koa/Express 中间件）：
 *
 *   Request ──► MW1 ──► MW2 ──► Agent ──► MW2 ──► MW1 ──► Response
 *                │                 │                 │
 *                ▼                 ▼                 ▼
 *           ContextInject     CostTrack        OutputValidate
 *
 * 体现 Harness Engineering 的核心思想：
 * Agent 的能力不是固定的，而是通过可组合的中间件来"装配"。
 * 每个中间件在 Agent 执行前后注入控制逻辑。
 */

import type { RunContext } from '../agent/types';
import type { AgentResult } from '../agent/types';

/** 中间件定义 */
export interface MiddlewareDefinition {
  name: string;
  handler: MiddlewareHandler;
  /** 优先级（数字越小越靠外，即越早执行） */
  priority?: number;
}

/** 中间件处理函数 */
export type MiddlewareHandler = (
  ctx: RunContext,
  next: () => Promise<AgentResult>,
) => Promise<AgentResult>;

export class MiddlewarePipeline {
  private middlewares: MiddlewareDefinition[] = [];

  /** 注册中间件 */
  use(mw: MiddlewareDefinition): void {
    this.middlewares.push(mw);
    // 按优先级排序
    this.middlewares.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /** 执行中间件链 */
  async run(ctx: RunContext, finalHandler: () => Promise<AgentResult>): Promise<AgentResult> {
    return this.compose(this.middlewares, finalHandler)(ctx);
  }

  /** 组合中间件（洋葱模型核心） */
  private compose(middlewares: MiddlewareDefinition[], final: () => Promise<AgentResult>) {
    return (ctx: RunContext): Promise<AgentResult> => {
      let index = -1;

      const dispatch = (i: number): Promise<AgentResult> => {
        if (i <= index) {
          return Promise.reject(new Error('Middleware next() called multiple times'));
        }
        index = i;

        if (i >= middlewares.length) {
          return final();
        }

        const mw = middlewares[i];
        return mw.handler(ctx, () => dispatch(i + 1));
      };

      return dispatch(0);
    };
  }
}

// ===== 内置中间件 =====

/**
 * ContextInjector — 上下文注入中间件
 *
 * 在 Agent 执行前注入项目上下文
 * （如 CLAUDE.md、代码库结构、架构文档等）
 */
export function createContextInjector(
  contextProvider: () => Promise<string> | string,
): MiddlewareDefinition {
  return {
    name: 'context-injector',
    priority: 10, // 最外层
    handler: async (ctx, next) => {
      const context = await contextProvider();
      if (context) {
        // 在 system prompt 末尾追加上下文
        const systemMsg = ctx.messages.find((m) => m.role === 'system');
        if (systemMsg) {
          systemMsg.content += `\n\n<context>\n${context}\n</context>`;
        }
      }
      return next();
    },
  };
}

/**
 * OutputValidator — 输出校验中间件
 *
 * 在 Agent 返回最终结果前对输出进行校验
 * （语法检查、安全扫描、格式校验、规则检查）
 */
export function createOutputValidator(
  validator: (output: string) => Promise<{ valid: boolean; reason?: string }> | { valid: boolean; reason?: string },
): MiddlewareDefinition {
  return {
    name: 'output-validator',
    priority: 90, // 最内层
    handler: async (ctx, next) => {
      const result = await next();

      if (result.success) {
        const validation = await validator(result.output);
        if (!validation.valid) {
          return {
            ...result,
            success: false,
            error: `Output validation failed: ${validation.reason || 'Unknown reason'}`,
          };
        }
      }

      return result;
    },
  };
}

/**
 * CostTracker — 成本追踪中间件
 *
 * 追踪每次 Agent 执行的 Token 消耗和费用
 */
export function createCostTracker(options?: {
  /** 每 1K tokens 的价格 (USD) */
  inputPricePerK?: number;
  outputPricePerK?: number;
}): MiddlewareDefinition {
  const inputPrice = options?.inputPricePerK ?? 0.003; // GPT-4o 默认
  const outputPrice = options?.outputPricePerK ?? 0.015;

  return {
    name: 'cost-tracker',
    priority: 80,
    handler: async (ctx, next) => {
      const result = await next();
      if (result.success) {
        const cost =
          (result.tokens.input / 1000) * inputPrice +
          (result.tokens.output / 1000) * outputPrice;
        // 将 cost 附加到结果中供下游使用
        (result.tokens as Record<string, number>).estimatedCost = cost;
      }
      return result;
    },
  };
}

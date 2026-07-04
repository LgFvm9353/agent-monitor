/**
 * Budget Guard — Token 预算护栏
 *
 * 追踪 Agent 执行的 Token 消耗和费用，在超出预算时停止执行。
 * 防止 Agent 陷入无限循环导致 API 费用失控。
 */

import type { Guardrail, GuardResult } from './types';
import type { RunContext } from '../agent/types';

/** Token 定价（每 1K tokens 的 USD 价格） */
export interface TokenPricing {
  /** 输入价格 */
  inputPerK: number;
  /** 输出价格 */
  outputPerK: number;
}

/** 预算配置 */
export interface BudgetConfig {
  /** Token 预算上限 */
  maxTokens?: number;
  /** 费用预算上限 (USD) */
  maxCost?: number;
  /** 输入/输出定价 */
  pricing?: TokenPricing;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 常用模型定价参考（每 1K tokens） */
export const MODEL_PRICING: Record<string, TokenPricing> = {
  'gpt-4o': { inputPerK: 0.0025, outputPerK: 0.01 },
  'gpt-4o-mini': { inputPerK: 0.00015, outputPerK: 0.0006 },
  'claude-fable-5': { inputPerK: 0.003, outputPerK: 0.015 },
  'claude-sonnet-4-6': { inputPerK: 0.003, outputPerK: 0.015 },
  'claude-haiku-4-5-20251001': { inputPerK: 0.001, outputPerK: 0.005 },
  'deepseek-v3': { inputPerK: 0.00027, outputPerK: 0.0011 },
};

/**
 * 创建 Token 预算护栏
 *
 * @example
 * ```ts
 * // 限制最多消耗 50K tokens
 * const budget = createBudgetGuard({ maxTokens: 50_000 });
 *
 * // 限制费用不超过 $0.50
 * const budget = createBudgetGuard({
 *   maxCost: 0.50,
 *   pricing: MODEL_PRICING['gpt-4o'],
 * });
 *
 * runner.withGuardrails([budget]);
 * ```
 */
export function createBudgetGuard(
  config: BudgetConfig = {},
): Guardrail {
  const isEnabled = config.enabled !== false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  return {
    name: 'budget-guard',

    beforeLLM(_ctx: RunContext, messages: unknown[]): GuardResult {
      if (!isEnabled) return { allowed: true };

      // 粗略估算输入 tokens
      const inputTokens = estimateMessagesTokens(messages);

      // 检查是否超过 token 预算
      if (config.maxTokens) {
        const total = totalInputTokens + totalOutputTokens + inputTokens;
        if (total > config.maxTokens) {
          return {
            allowed: false,
            reason: `Token 预算已耗尽。当前: ${totalInputTokens + totalOutputTokens}/${config.maxTokens} tokens`,
            suggestion: '请缩小任务范围或增加预算上限。',
          };
        }
      }

      // 检查是否超过费用预算
      if (config.maxCost && config.pricing) {
        const cost =
          (totalInputTokens / 1000) * config.pricing.inputPerK +
          (totalOutputTokens / 1000) * config.pricing.outputPerK;
        // 预估本次 LLM 调用的输入费用
        const estimatedCost = cost + (inputTokens / 1000) * config.pricing.inputPerK;

        if (estimatedCost > config.maxCost) {
          return {
            allowed: false,
            reason: `费用预算已耗尽。预估费用: $${estimatedCost.toFixed(4)} / 预算: $${config.maxCost.toFixed(4)}`,
            suggestion: '请缩小任务范围或增加预算上限。',
          };
        }
      }

      // 记录输入 tokens（粗略）
      totalInputTokens += inputTokens;

      return { allowed: true };
    },

    afterLLM(_ctx: RunContext, response: string): GuardResult {
      if (!isEnabled) return { allowed: true };

      // 粗略估算输出 tokens
      const outputTokens = estimateTextTokens(response);
      totalOutputTokens += outputTokens;

      return { allowed: true };
    },

    /**
     * 获取当前消耗统计
     */
    getStats(): { inputTokens: number; outputTokens: number; totalTokens: number } {
      return {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      };
    },
  } as Guardrail & { getStats: () => { inputTokens: number; outputTokens: number; totalTokens: number } };
}

/** 估算消息列表的 token 数 */
function estimateMessagesTokens(messages: unknown[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = (msg as Record<string, string>).content || '';
    const toolCalls = (msg as Record<string, unknown[]>).tool_calls;
    total += estimateTextTokens(content);
    if (toolCalls) {
      for (const tc of toolCalls) {
        total += estimateTextTokens(JSON.stringify(tc));
      }
    }
  }
  return total;
}

/** 粗略 Token 估算（英文：~4 chars/token，中文：~1.5 chars/token） */
function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const latinChars = (text.match(/[a-zA-Z0-9\s.,!?;:'"()\[\]{}]/g) || []).length;
  const otherChars = text.length - latinChars;
  return Math.ceil(latinChars / 4 + otherChars / 1.5);
}

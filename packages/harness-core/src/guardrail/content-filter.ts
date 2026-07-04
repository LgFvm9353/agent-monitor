/**
 * Content Filter Guardrail — 内容过滤护栏
 *
 * 在 LLM 输入/输出阶段检查不安全内容。
 * 支持内置正则规则 + 外部自定义校验器。
 */

import type { Guardrail, GuardResult } from './types';
import type { RunContext } from '../agent/types';

/** 内容过滤配置 */
export interface ContentFilterConfig {
  /** 禁止的输入模式（正则表达式列表） */
  blockedInputPatterns?: RegExp[];
  /** 禁止的输出模式（正则表达式列表） */
  blockedOutputPatterns?: RegExp[];
  /** 外部自定义校验器（如调用内容安全 API） */
  externalValidator?: (text: string, phase: 'input' | 'output') => Promise<{ safe: boolean; reason?: string }>;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/**
 * 默认的禁止输入模式
 *
 * 覆盖常见的 prompt injection / jailbreak 尝试
 */
const DEFAULT_BLOCKED_INPUT_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+instructions/i,
  /forget\s+(all\s+)?(previous|above|prior)\s+instructions/i,
  /you\s+are\s+now\s+DAN/i,
  /jailbreak/i,
  /system\s*prompt\s*(leak|reveal|show|display|output|print)/i,
];

/**
 * 默认的禁止输出模式
 */
const DEFAULT_BLOCKED_OUTPUT_PATTERNS: RegExp[] = [
  // 危险代码执行
  /rm\s+-rf\s+\//,
  /DROP\s+TABLE/i,
  /eval\s*\(\s*['"]require/,
  // 个人信息泄露模式
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN 格式
  /\b\d{16}\b/,              // 信用卡号格式
];

/**
 * 创建内容过滤护栏
 *
 * @example
 * ```ts
 * const filter = createContentFilterGuard({
 *   blockedInputPatterns: [/admin\s*password/i],
 *   externalValidator: async (text, phase) => {
 *     // 调用内容安全 API
 *     return { safe: true };
 *   },
 * });
 *
 * runner.withGuardrails([filter]);
 * ```
 */
export function createContentFilterGuard(
  config: ContentFilterConfig = {},
): Guardrail {
  const inputPatterns = config.blockedInputPatterns ?? DEFAULT_BLOCKED_INPUT_PATTERNS;
  const outputPatterns = config.blockedOutputPatterns ?? DEFAULT_BLOCKED_OUTPUT_PATTERNS;
  const isEnabled = config.enabled !== false;

  return {
    name: 'content-filter',

    beforeLLM(_ctx: RunContext, messages: unknown[]): GuardResult {
      if (!isEnabled) return { allowed: true };

      // 检查用户消息中的不安全内容
      const userMessages = messages.filter(
        (m: unknown) => (m as Record<string, unknown>).role === 'user'
      );
      for (const msg of userMessages) {
        const content = (msg as Record<string, string>).content || '';
        for (const pattern of inputPatterns) {
          if (pattern.test(content)) {
            return {
              allowed: false,
              reason: `输入内容匹配禁止模式: ${pattern.source}`,
              suggestion: '请以正常方式提出请求，不要尝试绕过系统指令。',
            };
          }
        }
      }
      return { allowed: true };
    },

    async afterLLM(_ctx: RunContext, response: string): Promise<GuardResult> {
      if (!isEnabled) return { allowed: true };

      // 检查输出中的不安全内容
      for (const pattern of outputPatterns) {
        if (pattern.test(response)) {
          return {
            allowed: false,
            reason: `输出内容匹配禁止模式: ${pattern.source}`,
            suggestion: '输出被内容过滤器拦截。',
          };
        }
      }

      // 外部校验器
      if (config.externalValidator) {
        const result = await config.externalValidator(response, 'output');
        if (!result.safe) {
          return {
            allowed: false,
            reason: result.reason || '外部校验器判定内容不安全',
          };
        }
      }

      return { allowed: true };
    },
  };
}

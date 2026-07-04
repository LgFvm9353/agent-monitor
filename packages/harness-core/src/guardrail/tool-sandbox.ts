/**
 * Tool Sandbox Guardrail — 工具沙箱护栏
 *
 * 在工具执行前进行权限检查：
 * 1. Allow/Deny 列表控制哪些工具可用
 * 2. 参数过滤——剔除危险参数
 * 3. 执行超时——防止工具长时间阻塞
 */

import type { Guardrail, GuardResult } from './types';
import type { RunContext } from '../agent/types';

/** 工具沙箱配置 */
export interface ToolSandboxConfig {
  /** 工具允许列表（白名单模式） */
  allowedTools?: string[];
  /** 工具禁止列表（黑名单模式） */
  deniedTools?: string[];
  /** 每个工具的执行超时时间 (ms)，默认 30s */
  timeoutMs?: number;
  /** 每个工具的最大调用次数（防循环），默认 50 */
  maxCallsPerTool?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/**
 * 创建工具沙箱护栏
 *
 * @example
 * ```ts
 * const sandbox = createToolSandboxGuard({
 *   allowedTools: ['read_file', 'search', 'calculator'],
 *   deniedTools: ['execute_command', 'shell'],
 *   timeoutMs: 10_000, // 10秒超时
 * });
 *
 * runner.withGuardrails([sandbox]);
 * ```
 */
export function createToolSandboxGuard(
  config: ToolSandboxConfig = {},
): Guardrail {
  const isEnabled = config.enabled !== false;
  const callCounts = new Map<string, number>();

  return {
    name: 'tool-sandbox',

    beforeTool(_ctx: RunContext, toolName: string, args: Record<string, unknown>): GuardResult {
      if (!isEnabled) return { allowed: true };

      // 白名单检查
      if (config.allowedTools && !config.allowedTools.includes(toolName)) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 不在允许列表中。允许的工具: ${config.allowedTools.join(', ')}`,
        };
      }

      // 黑名单检查
      if (config.deniedTools?.includes(toolName)) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 被禁止使用。`,
        };
      }

      // 调用次数检查
      const limit = config.maxCallsPerTool ?? 50;
      const count = callCounts.get(toolName) || 0;
      if (count >= limit) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 已达到最大调用次数 (${limit})。`,
        };
      }
      callCounts.set(toolName, count + 1);

      // 参数安全检查
      const argResult = validateArgs(toolName, args);
      if (!argResult.allowed) return argResult;

      return { allowed: true };
    },

    afterTool(_ctx: RunContext, toolName: string, result: unknown): GuardResult {
      // 检查工具结果是否过大
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      if (resultStr.length > 1_000_000) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 返回结果过大 (${resultStr.length} 字符)，防止上下文溢出。`,
          suggestion: '请调整查询范围以获取更精确的结果。',
        };
      }
      return { allowed: true };
    },
  };
}

/**
 * 参数安全检查
 *
 * 检测常见危险模式：路径遍历、命令注入等
 */
function validateArgs(toolName: string, args: Record<string, unknown>): GuardResult {
  const argsStr = JSON.stringify(args).toLowerCase();

  // 路径遍历检测
  if (argsStr.includes('../') || argsStr.includes('..\\')) {
    return {
      allowed: false,
      reason: `工具 "${toolName}" 参数包含路径遍历 (../)`,
      suggestion: '请使用绝对路径或限制在项目目录内。',
    };
  }

  // 命令注入检测
  const injectionPatterns = [
    /\|\s*(sh|bash|cmd|powershell)/i,
    /;\s*(rm|wget|curl)/i,
    /`[^`]+`/,            // 反引号命令替换
    /\$\([^)]+\)/,        // $(command) 命令替换
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(argsStr)) {
      return {
        allowed: false,
        reason: `工具 "${toolName}" 参数包含潜在的命令注入模式: ${pattern.source}`,
        suggestion: '命令参数需要经过安全审查。',
      };
    }
  }

  return { allowed: true };
}

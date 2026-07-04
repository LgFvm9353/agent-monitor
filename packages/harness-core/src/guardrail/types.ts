/**
 * Guardrail — 安全护栏类型定义
 *
 * 护栏是 Agent 安全执行的基础设施。每次 LLM 调用前后、每次工具调用前后，
 * 护栏都有机会检查并阻止不安全的操作。
 */

import type { RunContext } from '../agent/types';

/** 护栏检查结果 */
export interface GuardResult {
  /** 是否允许继续 */
  allowed: boolean;
  /** 拒绝原因（当 allowed=false 时） */
  reason?: string;
  /** 建议的替代方案 */
  suggestion?: string;
}

/**
 * 护栏接口
 *
 * 每个护栏实现生命周期方法，在 Agent 执行的不同阶段被调用。
 * 返回 GuardResult.allowed=false 会中止当前执行。
 */
export interface Guardrail {
  /** 护栏名称（用于日志/追踪） */
  readonly name: string;

  /**
   * LLM 调用前检查
   *
   * @param ctx - 当前运行时上下文
   * @param messages - 即将发送给 LLM 的消息列表
   * @returns 是否允许此 LLM 调用
   */
  beforeLLM?(ctx: RunContext, messages: unknown[]): Promise<GuardResult> | GuardResult;

  /**
   * LLM 调用后检查
   *
   * @param ctx - 当前运行时上下文
   * @param response - LLM 返回的文本内容
   * @returns 是否接受此响应
   */
  afterLLM?(ctx: RunContext, response: string): Promise<GuardResult> | GuardResult;

  /**
   * 工具调用前检查
   *
   * @param ctx - 当前运行时上下文
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @returns 是否允许此工具调用
   */
  beforeTool?(ctx: RunContext, toolName: string, args: Record<string, unknown>): Promise<GuardResult> | GuardResult;

  /**
   * 工具调用后检查
   *
   * @param ctx - 当前运行时上下文
   * @param toolName - 工具名称
   * @param result - 工具返回结果
   * @returns 是否接受此工具结果
   */
  afterTool?(ctx: RunContext, toolName: string, result: unknown): Promise<GuardResult> | GuardResult;
}

/** 护栏检查阶段 */
export type GuardPhase = 'beforeLLM' | 'afterLLM' | 'beforeTool' | 'afterTool';

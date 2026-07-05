/**
 * Planning — 规划系统类型定义
 *
 * Agent 的 Planning 能力是"复杂 Agent"区别于"简单 ChatBot"的关键特征。
 * 在接收到复杂任务后，Agent 首先进行任务分解（Plan），
 * 然后按依赖关系逐步执行（Execute），执行过程中可以动态调整（Replan）。
 *
 * 流程：Goal → TaskPlanner → Plan (DAG) → Execute → Replan → ... → Done
 */

/** 任务步骤状态 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/** 计划状态 */
export type PlanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'replanned';

/**
 * 任务步骤
 *
 * 计划中的最小执行单元。每个步骤可以：
 * - 依赖其他步骤（形成 DAG）
 * - 绑定特定工具
 * - 记录执行结果
 */
export interface TaskStep {
  /** 步骤唯一 ID */
  id: string;
  /** 步骤描述（给 LLM 看的自然语言） */
  description: string;
  /** 执行状态 */
  status: TaskStatus;
  /** 依赖的步骤 ID 列表 */
  dependencies: string[];
  /** 建议使用的工具名（可选） */
  assignedTool?: string;
  /** 步骤执行结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** 预估优先级（越高越优先，用于并行调度） */
  priority?: number;
}

/**
 * 执行计划
 *
 * TaskPlanner 的输出，包含任务分解后的 DAG。
 */
export interface Plan {
  /** 计划唯一 ID */
  id: string;
  /** 原始用户目标 */
  goal: string;
  /** 任务步骤列表（DAG 节点） */
  steps: TaskStep[];
  /** 计划状态 */
  status: PlanStatus;
  /** 创建时间 */
  createdAt: number;
  /** 计划摘要（LLM 生成的执行思路） */
  reasoning?: string;
}

/**
 * 规划器配置
 */
export interface PlannerConfig {
  /** 规划策略 */
  strategy: PlanningStrategy;
  /** 最大步骤数 */
  maxSteps?: number;
  /** 是否启用动态重规划 */
  enableReplan?: boolean;
  /** 重规划的最大次数 */
  maxReplans?: number;
  /** 自定义规划函数（用于测试或自定义逻辑） */
  customPlanner?: (goal: string, context?: string) => Promise<Plan> | Plan;
}

/**
 * 规划策略接口
 *
 * 不同策略决定步骤的执行顺序：
 * - sequential: 严格按顺序执行
 * - parallel: 无依赖的步骤并行执行
 * - adaptive: 每步完成后重新评估，动态调整剩余步骤
 */
export interface PlanningStrategy {
  readonly name: string;

  /**
   * 选择下一步要执行的步骤
   *
   * @param plan - 当前计划
   * @param completedSteps - 已完成步骤的 ID 集合
   * @returns 应该下一步执行的步骤列表（多个表示并行）
   */
  selectNext(plan: Plan, completedSteps: Set<string>): TaskStep[];

  /**
   * 检查计划是否全部完成
   */
  isComplete(plan: Plan): boolean;
}

/**
 * 规划结果
 */
export interface PlanningResult {
  plan: Plan;
  /** 执行 trace：每步的输入输出 */
  executionTrace: Array<{
    stepId: string;
    input?: string;
    output?: string;
    error?: string;
    duration: number;
  }>;
  /** 最终输出 */
  finalOutput: string;
  /** 重规划次数 */
  replanCount: number;
}

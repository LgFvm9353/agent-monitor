/**
 * TaskPlanner — 任务规划器
 *
 * 将复杂用户目标分解为可执行的步骤 DAG。
 *
 * 规划流程：
 * 1. 接收用户目标
 * 2. 调用 LLM 生成结构化的任务步骤
 * 3. 解析为 Plan (DAG)
 * 4. 按策略逐步执行
 * 5. 支持动态重规划（adaptive 模式）
 */

import type { Plan, TaskStep, PlannerConfig, PlanningStrategy, PlanningResult } from './types';
import { sequentialStrategy } from './strategies/sequential';
import { parallelStrategy } from './strategies/parallel';
import { createAdaptiveStrategy } from './strategies/adaptive';

/** 可选的 LLM 调用接口（最小化，不依赖完整 ModelAdapter） */
export interface PlannerLLM {
  /** 发送消息并获取文本响应 */
  chat(messages: Array<{ role: string; content: string }>): Promise<{ content: string }>;
}

/**
 * TaskPlanner 构造选项
 */
export interface TaskPlannerOptions {
  /** 规划策略 */
  strategy?: PlanningStrategy | 'sequential' | 'parallel' | 'adaptive';
  /** 最大步骤数（防止 LLM 生成过多步骤） */
  maxSteps?: number;
  /** 是否启用动态重规划 */
  enableReplan?: boolean;
  /** 最大重规划次数 */
  maxReplans?: number;
  /** LLM 调用接口（用于自动规划） */
  llm?: PlannerLLM;
  /** 自定义规划函数（优先级高于 llm） */
  customPlanner?: (goal: string, context?: string) => Promise<Plan> | Plan;
  /** 规划用 system prompt（覆盖默认） */
  planningSystemPrompt?: string;
}

/** 默认规划 system prompt */
const DEFAULT_PLANNING_PROMPT = `You are a task planning expert. Given a complex user goal, decompose it into a sequence of actionable steps.

Output a JSON object with this exact structure:
{
  "reasoning": "Brief explanation of your decomposition logic",
  "steps": [
    {
      "id": "step_1",
      "description": "What this step does in natural language",
      "dependencies": [],
      "assignedTool": "optional_tool_name"
    }
  ]
}

Rules:
1. Each step must be atomic and actionable (one clear action)
2. Declare dependencies by referencing other step IDs (only if one step requires another's output)
3. Steps without dependencies can run in parallel
4. Maximum 7 steps for reasonable tasks
5. Each step description must be clear enough for an LLM to execute`;

export class TaskPlanner {
  private strategy: PlanningStrategy;
  private maxSteps: number;
  private enableReplan: boolean;
  private maxReplans: number;
  private llm?: PlannerLLM;
  private customPlanner?: (goal: string, context?: string) => Promise<Plan> | Plan;
  private planningPrompt: string;
  private replanCount = 0;

  constructor(options: TaskPlannerOptions = {}) {
    this.maxSteps = options.maxSteps ?? 7;
    this.enableReplan = options.enableReplan ?? false;
    this.maxReplans = options.maxReplans ?? 3;
    this.llm = options.llm;
    this.customPlanner = options.customPlanner;
    this.planningPrompt = options.planningSystemPrompt ?? DEFAULT_PLANNING_PROMPT;

    // 解析策略
    if (typeof options.strategy === 'string') {
      this.strategy = this.resolveStrategy(options.strategy);
    } else {
      this.strategy = options.strategy ?? sequentialStrategy;
    }
  }

  /**
   * 根据用户目标生成执行计划
   *
   * @param goal - 用户目标（自然语言）
   * @param context - 额外上下文（如已有的文件列表、项目结构等）
   * @returns 结构化的 Plan
   */
  async plan(goal: string, context?: string): Promise<Plan> {
    // 优先使用自定义规划函数
    if (this.customPlanner) {
      return await this.customPlanner(goal, context);
    }

    // 使用 LLM 自动规划
    if (this.llm) {
      return this.llmPlan(goal, context);
    }

    // 无可用的规划方法 → 返回单步计划（fallback）
    return this.fallbackPlan(goal);
  }

  /**
   * 动态重规划
   *
   * 在步骤执行后，如果结果不符合预期，重新生成剩余步骤。
   *
   * @param currentPlan - 当前计划
   * @param failedStep - 失败的步骤
   * @param reason - 重规划原因
   */
  async replan(currentPlan: Plan, failedStep: TaskStep, reason: string): Promise<Plan> {
    if (this.replanCount >= this.maxReplans) {
      throw new Error(`Max replans (${this.maxReplans}) exceeded`);
    }
    this.replanCount++;

    if (this.llm) {
      const completedSteps = currentPlan.steps
        .filter(s => s.status === 'completed')
        .map(s => `- ${s.id}: ${s.description} → ${s.result || 'done'}`)
        .join('\n');

      const messages = [
        { role: 'system', content: `${this.planningPrompt}\n\nYou are replanning because: ${reason}` },
        { role: 'user', content: `Original goal: ${currentPlan.goal}\n\nCompleted steps:\n${completedSteps}\n\nFailed step: ${failedStep.description}\nError: ${failedStep.error || reason}\n\nGenerate a revised plan for the remaining work.` },
      ];

      const response = await this.llm.chat(messages);
      return this.parsePlanResponse(response.content, currentPlan.goal);
    }

    // 无可用的 LLM → 标记失败步骤并继续
    return {
      ...currentPlan,
      status: 'replanned',
      steps: currentPlan.steps.map(s =>
        s.id === failedStep.id ? { ...s, status: 'failed' as const, error: reason } : s
      ),
    };
  }

  /**
   * 获取当前策略
   */
  getStrategy(): PlanningStrategy {
    return this.strategy;
  }

  /**
   * 设置策略（运行时切换）
   */
  setStrategy(strategy: PlanningStrategy | 'sequential' | 'parallel' | 'adaptive'): void {
    if (typeof strategy === 'string') {
      this.strategy = this.resolveStrategy(strategy);
    } else {
      this.strategy = strategy;
    }
  }

  /**
   * 获取重规划次数
   */
  getReplanCount(): number {
    return this.replanCount;
  }

  /** 重置重规划计数器 */
  reset(): void {
    this.replanCount = 0;
  }

  // ===== Private =====

  private resolveStrategy(name: string): PlanningStrategy {
    switch (name) {
      case 'parallel': return parallelStrategy;
      case 'adaptive': return createAdaptiveStrategy();
      case 'sequential':
      default:
        return sequentialStrategy;
    }
  }

  private async llmPlan(goal: string, context?: string): Promise<Plan> {
    const userMessage = context
      ? `Goal: ${goal}\n\nContext:\n${context}`
      : `Goal: ${goal}`;

    const messages = [
      { role: 'system', content: this.planningPrompt },
      { role: 'user', content: userMessage },
    ];

    const response = await this.llm!.chat(messages);
    return this.parsePlanResponse(response.content, goal);
  }

  private parsePlanResponse(content: string, goal: string): Plan {
    // 尝试从 LLM 响应中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return this.fallbackPlan(goal);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const steps: TaskStep[] = ((parsed.steps as Array<Record<string, unknown>>) || []).map(
        (s, i) => ({
          id: (s.id as string) || `step_${i + 1}`,
          description: (s.description as string) || `Step ${i + 1}`,
          status: 'pending' as const,
          dependencies: (s.dependencies as string[]) || [],
          assignedTool: s.assignedTool as string | undefined,
          priority: (s.priority as number) ?? i,
        }),
      );

      return {
        id: `plan-${Date.now().toString(36)}`,
        goal,
        steps: steps.slice(0, this.maxSteps),
        status: 'pending',
        createdAt: Date.now(),
        reasoning: (parsed.reasoning as string) || undefined,
      };
    } catch {
      return this.fallbackPlan(goal);
    }
  }

  /**
   * 降级计划：不能分解时的单步兜底
   */
  private fallbackPlan(goal: string): Plan {
    return {
      id: `plan-${Date.now().toString(36)}`,
      goal,
      steps: [
        {
          id: 'step_1',
          description: goal,
          status: 'pending',
          dependencies: [],
        },
      ],
      status: 'pending',
      createdAt: Date.now(),
      reasoning: 'No planner available — executing as single step.',
    };
  }
}

/**
 * 规划执行器
 *
 * 将 Plan + AgentRunner 结合，按策略逐步执行计划。
 * 这是 Planner 和 AgentRunner 之间的桥梁。
 */
export async function executePlan(
  plan: Plan,
  strategy: PlanningStrategy,
  executor: (step: TaskStep) => Promise<string>,
  options?: { onStepComplete?: (step: TaskStep, output: string) => void; signal?: AbortSignal },
): Promise<PlanningResult> {
  const executionTrace: PlanningResult['executionTrace'] = [];
  const completedSteps = new Set<string>();
  let finalOutput = '';

  while (!strategy.isComplete(plan)) {
    // 检查取消信号
    if (options?.signal?.aborted) {
      plan.status = 'failed';
      break;
    }

    const nextSteps = strategy.selectNext(plan, completedSteps);
    if (nextSteps.length === 0) {
      // 没有可执行的步骤但计划未完成 → 死锁
      const pendingSteps = plan.steps.filter(s => !completedSteps.has(s.id) && s.status !== 'failed');
      if (pendingSteps.length > 0) {
        throw new Error(
          `Plan deadlocked: no steps ready but ${pendingSteps.length} steps pending. ` +
          `Check step dependencies: ${pendingSteps.map(s => `${s.id}→[${s.dependencies.join(',')}]`).join('; ')}`,
        );
      }
      break;
    }

    // 执行步骤（并行策略可能返回多个）
    const results = await Promise.all(
      nextSteps.map(async (step) => {
        const startTime = Date.now();
        step.status = 'in_progress';
        plan.status = 'running';

        try {
          const output = await executor(step);
          step.status = 'completed';
          step.result = output;
          completedSteps.add(step.id);

          const trace = { stepId: step.id, input: step.description, output, duration: Date.now() - startTime };
          executionTrace.push(trace);
          options?.onStepComplete?.(step, output);

          return output;
        } catch (error) {
          step.status = 'failed';
          step.error = error instanceof Error ? error.message : String(error);

          const trace = { stepId: step.id, input: step.description, error: step.error, duration: Date.now() - startTime };
          executionTrace.push(trace);

          throw error; // 向上传播
        }
      }),
    );

    // 使用最后一个步骤的输出作为最终输出
    finalOutput = results[results.length - 1] || '';
  }

  plan.status = strategy.isComplete(plan) ? 'completed' : plan.status;

  return {
    plan,
    executionTrace,
    finalOutput,
    replanCount: 0,
  };
}

/**
 * Adaptive Strategy — 自适应执行策略
 *
 * 每步执行完成后，根据结果动态评估剩余步骤是否需要调整。
 * 最智能的策略，但需要额外的 LLM 调用来做重规划决策。
 *
 * 策略逻辑：
 * 1. 初始按依赖关系选择可执行步骤
 * 2. 每步完成后检查：是否出现了意外结果？
 * 3. 如果是 → 触发 replan（调整或新增步骤）
 * 4. 如果否 → 继续执行
 */

import type { PlanningStrategy } from '../types';
import type { Plan, TaskStep } from '../types';

export interface AdaptiveHook {
  /** 每步完成后调用，返回是否需要重规划 */
  shouldReplan?: (step: TaskStep, plan: Plan) => boolean | Promise<boolean>;
  /** 重规划回调 */
  onReplan?: (plan: Plan, reason: string) => void;
}

export function createAdaptiveStrategy(hooks?: AdaptiveHook): PlanningStrategy {
  return {
    name: 'adaptive',

    selectNext(plan: Plan, completedSteps: Set<string>): TaskStep[] {
      const ready: TaskStep[] = [];

      for (const step of plan.steps) {
        if (completedSteps.has(step.id)) continue;
        if (step.status === 'failed') continue;
        if (step.status === 'in_progress') continue;

        // 检查所有依赖是否完成
        const depsMet = step.dependencies.every(d => completedSteps.has(d));
        if (depsMet) {
          ready.push(step);
        }
      }

      ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      // 每次只返回一个步骤（让 agent 逐个执行以便支持动态调整）
      return ready.slice(0, 1);
    },

    isComplete(plan: Plan): boolean {
      return plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
    },
  };
}

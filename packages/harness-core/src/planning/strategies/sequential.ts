/**
 * Sequential Strategy — 顺序执行策略
 *
 * 严格按步骤在 Plan 中的顺序依次执行。
 * 最安全但最慢的策略，适合有强依赖关系的任务。
 */

import type { PlanningStrategy } from '../types';
import type { Plan, TaskStep } from '../types';

export const sequentialStrategy: PlanningStrategy = {
  name: 'sequential',

  selectNext(plan: Plan, completedSteps: Set<string>): TaskStep[] {
    // 找到第一个未完成的步骤
    const next = plan.steps.find(s => !completedSteps.has(s.id) && s.status !== 'failed');
    if (!next) return [];

    // 检查其依赖是否完成
    const depsMet = next.dependencies.every(d => completedSteps.has(d));
    if (!depsMet) return [];

    return [next];
  },

  isComplete(plan: Plan): boolean {
    return plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
  },
};

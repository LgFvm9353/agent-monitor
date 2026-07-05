/**
 * Parallel Strategy — 并行执行策略
 *
 * 选择所有依赖已满足的步骤同时执行。
 * 适合步骤间无数据依赖的独立子任务。
 */

import type { PlanningStrategy } from '../types';
import type { Plan, TaskStep } from '../types';

export const parallelStrategy: PlanningStrategy = {
  name: 'parallel',

  selectNext(plan: Plan, completedSteps: Set<string>): TaskStep[] {
    // 找到所有依赖已满足、且尚未开始的步骤
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

    // 按优先级排序
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return ready;
  },

  isComplete(plan: Plan): boolean {
    return plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
  },
};

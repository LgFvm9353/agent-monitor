/**
 * TaskPlanner 和 planning strategies 单元测试
 */

import { describe, it, expect } from 'vitest';
import { TaskPlanner } from './planner';
import { sequentialStrategy } from './strategies/sequential';
import { parallelStrategy } from './strategies/parallel';
import type { Plan } from './types';

describe('TaskPlanner', () => {
  it('使用 customPlanner 生成计划', async () => {
    const planner = new TaskPlanner({
      customPlanner: async (goal) => ({
        id: 'plan-1',
        goal,
        steps: [
          { id: 's1', description: '第一步', status: 'pending', dependencies: [] },
          { id: 's2', description: '第二步', status: 'pending', dependencies: ['s1'] },
        ],
        status: 'pending',
        createdAt: Date.now(),
      }),
    });

    const plan = await planner.plan('完成一个任务');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1].dependencies).toContain('s1');
  });

  it('没有 LLM 也没有 customPlanner 时返回 fallback', async () => {
    const planner = new TaskPlanner();
    const plan = await planner.plan('做一件事');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].description).toBe('做一件事');
  });

  it('支持运行时切换策略', () => {
    const planner = new TaskPlanner({ strategy: 'sequential' });
    expect(planner.getStrategy().name).toBe('sequential');

    planner.setStrategy('parallel');
    expect(planner.getStrategy().name).toBe('parallel');
  });

  it('replan 标记失败步骤', async () => {
    const planner = new TaskPlanner({
      customPlanner: async (goal) => ({
        id: 'plan-1', goal,
        steps: [
          { id: 's1', description: 'Step 1', status: 'completed', dependencies: [], result: 'done' },
          { id: 's2', description: 'Step 2', status: 'pending', dependencies: [] },
        ],
        status: 'running', createdAt: Date.now(),
      }),
    });

    const plan = await planner.plan('test');
    const newPlan = await planner.replan(plan, plan.steps[1], 'Something went wrong');
    expect(newPlan.steps[1].status).toBe('failed');
    expect(newPlan.status).toBe('replanned');
  });

  it('超过最大重规划次数时抛出错误', async () => {
    const planner = new TaskPlanner({ maxReplans: 1, customPlanner: async () => ({
      id: 'p', goal: 'g', steps: [{ id: 's1', description: 's', status: 'pending', dependencies: [] }],
      status: 'pending', createdAt: 1,
    })});

    const plan = await planner.plan('g');
    await planner.replan(plan, plan.steps[0], 'err');
    await expect(planner.replan(plan, plan.steps[0], 'err2')).rejects.toThrow('Max replans');
  });
});

describe('sequentialStrategy', () => {
  it('按顺序选择下一步', () => {
    const plan: Plan = {
      id: 'p', goal: 'g', status: 'pending', createdAt: 1,
      steps: [
        { id: 's1', description: '1', status: 'pending', dependencies: [] },
        { id: 's2', description: '2', status: 'pending', dependencies: ['s1'] },
        { id: 's3', description: '3', status: 'pending', dependencies: ['s2'] },
      ],
    };

    const r1 = sequentialStrategy.selectNext(plan, new Set());
    expect(r1).toHaveLength(1);
    expect(r1[0].id).toBe('s1');

    const r2 = sequentialStrategy.selectNext(plan, new Set(['s1']));
    expect(r2).toHaveLength(1);
    expect(r2[0].id).toBe('s2');
  });

  it('所有步骤完成时 isComplete 返回 true', () => {
    const plan: Plan = {
      id: 'p', goal: 'g', status: 'pending', createdAt: 1,
      steps: [
        { id: 's1', description: '1', status: 'completed', dependencies: [], result: 'ok' },
      ],
    };
    expect(sequentialStrategy.isComplete(plan)).toBe(true);
  });
});

describe('parallelStrategy', () => {
  it('同时选中无依赖的步骤', () => {
    const plan: Plan = {
      id: 'p', goal: 'g', status: 'pending', createdAt: 1,
      steps: [
        { id: 's1', description: 'a', status: 'pending', dependencies: [], priority: 2 },
        { id: 's2', description: 'b', status: 'pending', dependencies: [], priority: 1 },
        { id: 's3', description: 'c', status: 'pending', dependencies: ['s1'] },
      ],
    };

    const result = parallelStrategy.selectNext(plan, new Set());
    expect(result).toHaveLength(2);
    // 高优先级的先
    expect(result[0].id).toBe('s1');
  });
});

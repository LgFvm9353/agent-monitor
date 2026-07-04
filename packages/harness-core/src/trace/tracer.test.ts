/**
 * Trace 模块单元测试
 *
 * 覆盖 StepRecorder 和 BreakpointManager。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StepRecorder, BreakpointManager } from './tracer';

describe('StepRecorder', () => {
  let recorder: StepRecorder;

  beforeEach(() => {
    recorder = new StepRecorder('test-session');
  });

  it('应该记录步骤', () => {
    recorder.record({
      stepIndex: 0,
      type: 'llm_call',
      name: 'LLM Call #1',
      input: 'hello',
      output: 'hi there',
      startTime: 1000,
      endTime: 2000,
      tokens: { input: 10, output: 5 },
      messageSnapshot: [{ role: 'user', content: 'hello' }],
    });

    const all = recorder.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ stepIndex: 0, type: 'llm_call' });
  });

  it('应该正确导出', () => {
    recorder.record({
      stepIndex: 0,
      type: 'llm_call',
      name: 'Test',
      startTime: 1000,
      endTime: 2000,
    });
    recorder.record({
      stepIndex: 1,
      type: 'tool_call',
      name: 'Tool: search',
      input: { query: 'test' },
      output: 'result',
      startTime: 2000,
      endTime: 3000,
    });

    const exported = recorder.export();
    expect(exported.sessionId).toBe('test-session');
    expect(exported.totalSteps).toBe(2);
    expect(exported.steps).toHaveLength(2);
  });

  it('应该正确导入和导出', () => {
    const data = {
      sessionId: 'imported-session',
      steps: [
        {
          stepIndex: 0,
          type: 'llm_call' as const,
          name: 'Test',
          startTime: 1000,
          endTime: 2000,
        },
      ],
    };

    recorder.import(data);
    const exported = recorder.export();
    expect(exported.sessionId).toBe('imported-session');
    expect(exported.totalSteps).toBe(1);
  });

  it('应该获取正确的统计信息', () => {
    recorder.record({
      stepIndex: 0,
      type: 'llm_call',
      name: 'LLM #1',
      startTime: 1000,
      endTime: 2000,
    });
    recorder.record({
      stepIndex: 1,
      type: 'tool_call',
      name: 'Tool: search',
      startTime: 2000,
      endTime: 3000,
    });
    recorder.record({
      stepIndex: 2,
      type: 'error',
      name: 'Error',
      startTime: 3000,
      endTime: 3500,
      error: 'Something went wrong',
    });

    const stats = recorder.getStats();
    expect(stats.totalSteps).toBe(3);
    expect(stats.llmCalls).toBe(1);
    expect(stats.toolCalls).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.totalDuration).toBe(2500);
  });

  it('应该获取指定步骤', () => {
    recorder.record({
      stepIndex: 5,
      type: 'llm_call',
      name: 'LLM #6',
      startTime: 5000,
      endTime: 6000,
    });

    const step = recorder.getStep(5);
    expect(step).toBeDefined();
    expect(step!.name).toBe('LLM #6');

    const missing = recorder.getStep(99);
    expect(missing).toBeUndefined();
  });

  it('clear 应该清空所有步骤', () => {
    recorder.record({
      stepIndex: 0,
      type: 'llm_call',
      name: 'Test',
      startTime: 1000,
      endTime: 2000,
    });
    recorder.clear();
    expect(recorder.getAll()).toHaveLength(0);
  });
});

describe('BreakpointManager', () => {
  let bpm: BreakpointManager;

  beforeEach(() => {
    bpm = new BreakpointManager();
  });

  it('应该匹配步骤类型断点', async () => {
    bpm.add({ id: 'bp1', onStepType: 'tool_call' });

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'tool_call',
    });
    expect(matched).toContain('bp1');
  });

  it('应该不匹配不同类型的断点', async () => {
    bpm.add({ id: 'bp1', onStepType: 'tool_call' });

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'llm_call',
    });
    expect(matched).not.toContain('bp1');
  });

  it('应该匹配工具名断点', async () => {
    bpm.add({ id: 'bp1', onToolName: 'write_file' });

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'tool_call',
      toolName: 'write_file',
    });
    expect(matched).toContain('bp1');
  });

  it('应该匹配步骤号断点', async () => {
    bpm.add({ id: 'bp1', onStepIndex: 5 });

    const matched = await bpm.shouldBreak({
      currentStep: 5,
      stepType: 'llm_call',
    });
    expect(matched).toContain('bp1');

    const notMatched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'llm_call',
    });
    expect(notMatched).not.toContain('bp1');
  });

  it('应该支持条件断点', async () => {
    bpm.add({
      id: 'bp1',
      condition: async (ctx) => ctx.output?.includes('error') ?? false,
    });

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'llm_call',
      output: 'An error occurred',
    });
    expect(matched).toContain('bp1');

    const notMatched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'llm_call',
      output: 'Everything is fine',
    });
    expect(notMatched).not.toContain('bp1');
  });

  it('waitForResume 应该在 resume 后恢复', async () => {
    bpm.add({ id: 'bp1' });

    // 模拟异步暂停/恢复
    const pausedPromise = bpm.waitForResume('bp1');

    // 在另一个微任务中恢复
    setTimeout(() => bpm.resume('bp1'), 10);

    const timedOut = await pausedPromise;
    expect(timedOut).toBe(false); // 不是超时恢复
    expect(bpm.getPausedBreakpoints()).toHaveLength(0);
  });

  it('waitForResume 应该在超时后自动恢复', async () => {
    bpm.add({ id: 'bp1' });

    const timedOut = await bpm.waitForResume('bp1', 50);
    expect(timedOut).toBe(true);
    expect(bpm.getPausedBreakpoints()).toHaveLength(0);
  });

  it('resumeAll 应该恢复所有暂停的断点', () => {
    bpm.add({ id: 'bp1' });
    bpm.add({ id: 'bp2' });

    // 启动两个暂停（在后台）
    void bpm.waitForResume('bp1');
    void bpm.waitForResume('bp2');

    setTimeout(() => bpm.resumeAll(), 10);
    // 验证 resumeAll 不会抛出
    expect(() => bpm.resumeAll()).not.toThrow();
  });

  it('remove 应该移除断点', async () => {
    bpm.add({ id: 'bp1', onStepType: 'tool_call' });
    bpm.remove('bp1');

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'tool_call',
    });
    expect(matched).not.toContain('bp1');
  });

  it('clearAll 应该清除所有断点和暂停状态', async () => {
    bpm.add({ id: 'bp1' });
    bpm.add({ id: 'bp2' });
    bpm.clearAll();

    const matched = await bpm.shouldBreak({
      currentStep: 3,
      stepType: 'llm_call',
    });
    expect(matched).toHaveLength(0);
    expect(bpm.getPausedBreakpoints()).toHaveLength(0);
  });
});

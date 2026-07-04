/**
 * error-id 单元测试
 */
import { describe, it, expect } from 'vitest';
import { generateErrorId } from '../../src/utils/error-id';

describe('generateErrorId', () => {
  it('应该为相同的堆栈生成相同的 ID', () => {
    const stack = 'Error: test\n    at foo (file.ts:10:5)\n    at bar (file.ts:20:3)';
    const id1 = generateErrorId(stack);
    const id2 = generateErrorId(stack);
    expect(id1).toBe(id2);
  });

  it('相同根因不同行列号应生成相同 ID', () => {
    const stack1 = 'Error: test\n    at foo (file.ts:10:5)\n    at bar (file.ts:20:3)';
    const stack2 = 'Error: test\n    at foo (file.ts:999:99)\n    at bar (file.ts:888:88)';
    expect(generateErrorId(stack1)).toBe(generateErrorId(stack2));
  });

  it('不同错误应生成不同 ID', () => {
    const id1 = generateErrorId('Error: TypeError\n    at foo (a.ts:1:1)');
    const id2 = generateErrorId('Error: ReferenceError\n    at bar (b.ts:2:2)');
    expect(id1).not.toBe(id2);
  });

  it('空字符串应返回 unknown-error', () => {
    expect(generateErrorId('')).toBe('unknown-error');
  });

  it('应过滤 node_modules 中的堆栈行', () => {
    const stack = 'Error: test\n    at node_modules/react/index.js:1:1';
    // 过滤后只剩 Error: test 一行
    const id = generateErrorId(stack);
    expect(id).toBe(generateErrorId('Error: test'));
  });

  it('应过滤 SDK 自身的堆栈行', () => {
    const stack = 'Error: test\n    at agent-harness/monitor-sdk/src/core.ts:1:1';
    const id = generateErrorId(stack);
    expect(id).toBe(generateErrorId('Error: test'));
  });

  it('生成的 ID 应以 err_ 开头', () => {
    const id = generateErrorId('Error: test');
    expect(id).toMatch(/^err_/);
  });

  it('相同消息但不同堆栈应生成不同 ID', () => {
    const id1 = generateErrorId('Error: oops\n    at a (x.ts:1:1)');
    const id2 = generateErrorId('Error: oops\n    at b (y.ts:1:1)');
    expect(id1).not.toBe(id2);
  });
});

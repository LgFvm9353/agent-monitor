/**
 * stack-parser 单元测试
 */
import { describe, it, expect } from 'vitest';
import { parseStackTrace, formatStackTrace } from '../../src/utils/stack-parser';

describe('parseStackTrace', () => {
  it('应解析 Chrome 格式堆栈', () => {
    const stack = 'Error: test\n    at foo (file.ts:10:5)\n    at bar (other.ts:20:3)';
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe('foo');
    expect(frames[0].fileName).toBe('file.ts');
    expect(frames[0].lineNumber).toBe(10);
    expect(frames[0].columnNumber).toBe(5);
    expect(frames[1].functionName).toBe('bar');
    expect(frames[1].fileName).toBe('other.ts');
    expect(frames[1].lineNumber).toBe(20);
    expect(frames[1].columnNumber).toBe(3);
  });

  it('应解析 Chrome 格式（匿名函数）', () => {
    const stack = 'Error: test\n    at file.ts:10:5';
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe('<anonymous>');
    expect(frames[0].fileName).toBe('file.ts');
  });

  it('应解析 Firefox 格式堆栈', () => {
    const stack = 'foo@file.ts:10:5\nbar@other.ts:20:3';
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe('foo');
    expect(frames[0].fileName).toBe('file.ts');
    expect(frames[1].functionName).toBe('bar');
    expect(frames[1].fileName).toBe('other.ts');
  });

  it('应混合解析 Chrome 和 Firefox 格式', () => {
    const stack = 'Error: test\n    at foo (file.ts:10:5)\nbar@other.ts:20:3';
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe('foo'); // Chrome
    expect(frames[1].functionName).toBe('bar');  // Firefox
  });

  it('空堆栈应返回空数组', () => {
    expect(parseStackTrace('')).toEqual([]);
  });

  it('无意义行应被忽略', () => {
    const stack = 'just a message\n    at real (file.ts:1:1)';
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe('real');
  });
});

describe('formatStackTrace', () => {
  it('应格式化堆栈帧为可读字符串', () => {
    const frames = [
      { functionName: 'foo', fileName: 'file.ts', lineNumber: 10 },
      { functionName: 'bar', fileName: 'other.ts', lineNumber: 20 },
    ];
    const result = formatStackTrace(frames);
    expect(result).toContain('at foo (file.ts:10)');
    expect(result).toContain('at bar (other.ts:20)');
  });

  it('匿名函数应显示 <anonymous>', () => {
    const frames = [{ fileName: 'file.ts', lineNumber: 1 }];
    const result = formatStackTrace(frames);
    expect(result).toContain('<anonymous>');
  });

  it('空帧列表应返回空字符串', () => {
    expect(formatStackTrace([])).toBe('');
  });
});

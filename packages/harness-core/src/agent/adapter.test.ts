/**
 * StreamAccumulator 单元测试
 *
 * 验证 OpenAI 和 Anthropic 流式 tool call 的累积正确性。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamAccumulator } from '../agent/adapter';

describe('StreamAccumulator', () => {
  let acc: StreamAccumulator;

  beforeEach(() => {
    acc = new StreamAccumulator();
  });

  describe('OpenAI 格式', () => {
    it('应该累积完整的 tool call', () => {
      // 第1帧：id + name
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_abc123',
        function: { name: 'search', arguments: '' },
      });
      expect(acc.hasPending).toBe(true);

      // 后续帧：分片 arguments
      acc.addOpenAIDelta({
        index: 0,
        function: { arguments: '{"query"' },
      });
      acc.addOpenAIDelta({
        index: 0,
        function: { arguments: ':"hello"}' },
      });

      const result = acc.drain();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'call_abc123',
        name: 'search',
        arguments: { query: 'hello' },
      });
      expect(acc.hasPending).toBe(false);
    });

    it('应该支持多个并行的 tool calls', () => {
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_1',
        function: { name: 'read', arguments: '{"path":"a.txt"}' },
      });
      acc.addOpenAIDelta({
        index: 1,
        id: 'call_2',
        function: { name: 'write', arguments: '{"path":"b.txt"}' },
      });

      const result = acc.drain();
      expect(result).toHaveLength(2);
    });

    it('应该在 drain 后重置', () => {
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_x',
        function: { name: 'tool', arguments: '{}' },
      });
      acc.drain();
      expect(acc.hasPending).toBe(false);
      expect(acc.drain()).toHaveLength(0);
    });

    it('应该处理无效 JSON 参数', () => {
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_bad',
        function: { name: 'tool', arguments: '{invalid' },
      });
      const result = acc.drain();
      expect(result).toHaveLength(1);
      expect(result[0].arguments).toHaveProperty('_raw', '{invalid');
    });

    it('peek 不应该清除数据', () => {
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_1',
        function: { name: 'tool', arguments: '{"x":1}' },
      });
      const peek1 = acc.peek();
      expect(peek1).toHaveLength(1);
      expect(acc.hasPending).toBe(true);
      // peek 后仍然可以 drain
      const drain1 = acc.drain();
      expect(drain1).toHaveLength(1);
    });
  });

  describe('Anthropic 格式', () => {
    it('应该通过 content_block 事件累积 tool use', () => {
      acc.addAnthropicEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_001', name: 'search' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query"' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: ':"hello"}' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_stop',
        index: 0,
      });

      const result = acc.drain();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'toolu_001',
        name: 'search',
        arguments: { query: 'hello' },
      });
    });

    it('应该忽略非 tool_use 的 content_block', () => {
      acc.addAnthropicEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', id: undefined, name: undefined },
      });
      // 不应该添加 pending tool call
      expect(acc.hasPending).toBe(false);
    });

    it('应该支持多个 content blocks', () => {
      acc.addAnthropicEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'read' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't2', name: 'search' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      });
      acc.addAnthropicEvent({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      });

      const result = acc.drain();
      expect(result).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('应该清除所有待处理的 tool calls', () => {
      acc.addOpenAIDelta({
        index: 0,
        id: 'call_1',
        function: { name: 'tool', arguments: '{}' },
      });
      acc.reset();
      expect(acc.hasPending).toBe(false);
      expect(acc.drain()).toHaveLength(0);
    });
  });
});

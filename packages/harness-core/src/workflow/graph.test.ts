/**
 * WorkflowGraph 单元测试
 */

import { describe, it, expect } from 'vitest';
import { WorkflowGraph } from './graph';
import { createLLMNodeExecutor } from './nodes/llm-node';
import { createToolNodeExecutor } from './nodes/tool-node';
import { createConditionNodeExecutor } from './nodes/condition-node';
import type { NodeType, NodeContext, NodeExecutor } from './types';

function createMockCtx(): NodeContext {
  return {
    messages: [],
    nodeResults: new Map(),
    runId: 'test-run',
  };
}

describe('WorkflowGraph', () => {
  it('构建简单的线性工作流并执行', async () => {
    const mockLLM = {
      chat: async () => ({ content: 'Response from LLM' }),
    };

    const graph = new WorkflowGraph()
      .addNode('n1', 'llm', { prompt: 'Step 1' })
      .addNode('n2', 'llm', { prompt: 'Step 2' })
      .addEdge('n1', 'n2');

    const executors = new Map<NodeType, NodeExecutor>();
    executors.set('llm', createLLMNodeExecutor(mockLLM) as NodeExecutor);
    executors.set('tool', createToolNodeExecutor({ execute: async () => 'ok' }) as NodeExecutor);

    const result = await graph.execute(executors, createMockCtx());
    expect(result.success).toBe(true);
    expect(result.trace).toHaveLength(2);
    expect(result.output).toBe('Response from LLM');
  });

  it('拓扑排序正确', () => {
    const graph = new WorkflowGraph()
      .addNode('a', 'llm', {})
      .addNode('b', 'tool', {})
      .addNode('c', 'llm', {})
      .addEdge('a', 'b')
      .addEdge('b', 'c');

    const order = graph.topologicalSort();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('分支图拓扑排序', () => {
    const graph = new WorkflowGraph()
      .addNode('a', 'llm', {})
      .addNode('b', 'tool', {})
      .addNode('c', 'tool', {})
      .addNode('d', 'llm', {})
      .addEdge('a', 'b')
      .addEdge('a', 'c')
      .addEdge('b', 'd')
      .addEdge('c', 'd');

    const order = graph.topologicalSort();
    expect(order[0]).toBe('a');
    expect(order[order.length - 1]).toBe('d');
    // b 和 c 在 a 之后，d 之前
    expect(order.indexOf('b')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('b'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('c'));
  });

  it('检测循环依赖', () => {
    const graph = new WorkflowGraph()
      .addNode('a', 'llm', {})
      .addNode('b', 'llm', {})
      .addEdge('a', 'b')
      .addEdge('b', 'a');

    expect(() => graph.topologicalSort()).toThrow('cycle');
  });

  it('节点失败时工作流终止', async () => {
    const failingExecutor = {
      nodeType: 'tool' as NodeType,
      execute: async () => { throw new Error('Tool failed'); },
    };

    const graph = new WorkflowGraph()
      .addNode('a', 'tool', { tool: 'broken' });

    const executors = new Map<NodeType, NodeExecutor>();
    executors.set('tool', failingExecutor);

    const result = await graph.execute(executors, createMockCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool failed');
  });

  it('支持设置入口节点', () => {
    const graph = new WorkflowGraph()
      .addNode('x', 'llm', {})
      .addNode('y', 'llm', {})
      .addNode('z', 'llm', {})
      .setEntry('y');

    const def = graph.getDef();
    expect(def.entryNodeId).toBe('y');
  });

  it('第一个节点默认作为入口', () => {
    const graph = new WorkflowGraph().addNode('first', 'llm', {});
    expect(graph.getDef().entryNodeId).toBe('first');
  });

  it('getNode 获取节点', () => {
    const graph = new WorkflowGraph().addNode('test', 'llm', { key: 'value' });
    const node = graph.getNode('test');
    expect(node).toBeDefined();
    expect(node!.config.key).toBe('value');
  });

  it('getNode 不存在的节点返回 undefined', () => {
    const graph = new WorkflowGraph();
    expect(graph.getNode('nonexistent')).toBeUndefined();
  });

  it('Condition node 返回 branch 名称', async () => {
    const graph = new WorkflowGraph()
      .addNode('cond', 'condition', { condition: 'branch_a' });

    const executors = new Map<NodeType, NodeExecutor>();
    executors.set('condition', createConditionNodeExecutor());

    const result = await graph.execute(executors, createMockCtx());
    expect(result.success).toBe(true);
    expect(result.output).toBe('branch_a');
  });
});

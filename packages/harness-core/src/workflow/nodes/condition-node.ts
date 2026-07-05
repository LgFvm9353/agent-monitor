/**
 * Condition Node — 条件分支节点
 *
 * 根据条件结果选择不同的后续节点。
 * config.condition 可以是字符串（评估为 JS 表达式）或函数。
 */

import type { NodeExecutor, WorkflowNode, NodeContext, NodeType } from '../types';

export function createConditionNodeExecutor(): NodeExecutor {
  return {
    nodeType: 'condition' as NodeType,

    async execute(node: WorkflowNode, ctx: NodeContext): Promise<string> {
      const condition = node.config.condition;
      if (!condition) throw new Error('Condition node requires "condition" config');

      // 支持函数条件
      if (typeof condition === 'function') {
        const fn = condition as (ctx: NodeContext, node: WorkflowNode) => string | Promise<string>;
        return fn(ctx, node);
      }

      // 支持字符串条件（返回 branch 名称）
      if (typeof condition === 'string') {
        // 简单的关键词匹配
        return condition;
      }

      return 'default';
    },
  };
}

/**
 * Tool Node — 工具调用节点
 *
 * 在工作流中执行指定的工具。
 */

import type { NodeExecutor, WorkflowNode, NodeContext, NodeType } from '../types';

/** 工具执行器接口 */
export interface ToolNodeExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createToolNodeExecutor(toolExecutor: ToolNodeExecutor): NodeExecutor {
  return {
    nodeType: 'tool' as NodeType,

    async execute(node: WorkflowNode, _ctx: NodeContext): Promise<unknown> {
      const toolName = node.config.tool as string;
      if (!toolName) throw new Error('Tool node requires "tool" config');

      const args = (node.config.args as Record<string, unknown>) || {};
      return toolExecutor.execute(toolName, args);
    },
  };
}

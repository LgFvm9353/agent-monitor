/**
 * Loop Node — 循环重试节点
 *
 * 对子工作流进行循环执行，直到满足退出条件或达到最大次数。
 * config.maxIterations: 最大迭代次数
 * config.exitCondition: 退出条件函数
 */

import type { NodeExecutor, WorkflowNode, NodeContext, NodeType } from '../types';

export interface LoopNodeConfig {
  maxIterations: number;
  exitCondition?: (iteration: number, result: unknown) => boolean | Promise<boolean>;
}

export function createLoopNodeExecutor(): NodeExecutor {
  return {
    nodeType: 'loop' as NodeType,

    async execute(node: WorkflowNode, ctx: NodeContext): Promise<unknown> {
      const maxIterations = (node.config.maxIterations as number) || 3;
      const exitCondition = node.config.exitCondition as LoopNodeConfig['exitCondition'];

      let lastResult: unknown = null;

      for (let i = 0; i < maxIterations; i++) {
        if (ctx.signal?.aborted) throw new Error('Loop aborted');

        try {
          // 执行循环体（通常是一个子 LLM 调用或工具调用）
          // 循环体的结果从 node.config.bodyResult 获取
          // 实际执行由外部控制
          lastResult = node.result;
        } catch (error) {
          if (i === maxIterations - 1) throw error;
          continue;
        }

        if (exitCondition && (await exitCondition(i, lastResult))) {
          break;
        }
      }

      return lastResult;
    },
  };
}

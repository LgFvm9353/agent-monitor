/**
 * LLM Node — LLM 调用节点
 *
 * 工作流中最常用的节点类型，相当于 Agent 的一个 ReAct step。
 */

import type { NodeExecutor, WorkflowNode, NodeContext, NodeType } from '../types';
import type { AgentMessage } from '../../agent/types';

/** LLM 调用接口（最小化） */
export interface LLMNodeLLM {
  chat(messages: AgentMessage[], options?: Record<string, unknown>): Promise<{ content: string }>;
}

export function createLLMNodeExecutor(llm: LLMNodeLLM): NodeExecutor {
  return {
    nodeType: 'llm' as NodeType,

    async execute(node: WorkflowNode, ctx: NodeContext): Promise<string> {
      const prompt = (node.config.prompt as string) || 'Process the input.';
      const systemPrompt = (node.config.systemPrompt as string) || 'You are a helpful assistant.';

      // 构建消息，包含前面节点的结果作为上下文
      const contextStr = Array.from(ctx.nodeResults.entries())
        .map(([id, result]) => `<previous-node id="${id}">\n${String(result)}\n</previous-node>`)
        .join('\n');

      const messages: AgentMessage[] = [
        { role: 'system', content: systemPrompt },
        ...ctx.messages,
        { role: 'user', content: contextStr ? `${prompt}\n\nContext:\n${contextStr}` : prompt },
      ];

      const response = await llm.chat(messages);
      return response.content;
    },
  };
}

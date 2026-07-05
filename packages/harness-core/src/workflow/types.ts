/**
 * Workflow — 工作流类型定义
 *
 * WorkflowGraph 是 Agent 执行的高级抽象——不再只是 ReAct 循环，
 * 而是由节点和有向边组成的 DAG。
 *
 * 节点类型：
 * - llm: LLM 调用（类似 Agent 的一个 step）
 * - tool: 工具调用
 * - condition: 条件分支（根据前一步结果选择路径）
 * - loop: 循环重试（失败后重试 N 次）
 * - human: 人工审批（等待外部确认）
 */

import type { AgentMessage } from '../agent/types';

/** 节点类型 */
export type NodeType = 'llm' | 'tool' | 'condition' | 'loop' | 'human';

/** 节点执行状态 */
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 边 — 定义节点间的执行流
 */
export interface Edge {
  from: string;
  to: string;
  /** 条件标签（condition 节点使用） */
  label?: string;
}

/**
 * 工作流节点
 */
export interface WorkflowNode {
  /** 节点 ID（在图中唯一） */
  id: string;
  /** 节点类型 */
  type: NodeType;
  /** 执行状态 */
  status: NodeStatus;
  /** 节点配置 */
  config: Record<string, unknown>;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
}

/**
 * 工作流图
 */
export interface WorkflowGraphDef {
  /** 节点列表 */
  nodes: WorkflowNode[];
  /** 边列表 */
  edges: Edge[];
  /** 入口节点 ID */
  entryNodeId: string;
}

/**
 * 节点执行上下文
 *
 * 在节点执行时传递的共享状态。
 */
export interface NodeContext {
  /** 当前消息历史 */
  messages: AgentMessage[];
  /** 前面节点的执行结果（nodeId → result） */
  nodeResults: Map<string, unknown>;
  /** 工作流运行 ID */
  runId: string;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 节点执行器接口
 *
 * 每种节点类型需要实现此接口。
 */
export interface NodeExecutor {
  readonly nodeType: NodeType;

  /**
   * 执行节点
   *
   * @param node - 要执行的节点
   * @param ctx - 执行上下文
   * @returns 执行结果
   */
  execute(node: WorkflowNode, ctx: NodeContext): Promise<unknown>;
}

/**
 * 工作流执行结果
 */
export interface WorkflowResult {
  /** 运行 ID */
  runId: string;
  /** 最终输出 */
  output: string;
  /** 节点执行结果 */
  nodeResults: Map<string, unknown>;
  /** 执行耗时 ms */
  duration: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 节点执行 trace */
  trace: Array<{
    nodeId: string;
    type: NodeType;
    status: NodeStatus;
    duration: number;
    error?: string;
  }>;
}

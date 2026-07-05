/**
 * WorkflowGraph — 工作流图执行引擎
 *
 * 支持 DAG 结构的工作流定义和执行。
 *
 * @example
 * ```ts
 * const graph = new WorkflowGraph()
 *   .addNode('analyze', 'llm', { prompt: 'Analyze the input...' })
 *   .addNode('search', 'tool', { tool: 'webSearch' })
 *   .addNode('summarize', 'llm', { prompt: 'Summarize findings...' })
 *   .addEdge('analyze', 'search')
 *   .addEdge('search', 'summarize');
 *
 * const result = await graph.execute(executors, ctx);
 * ```
 */

import type {
  WorkflowNode, WorkflowGraphDef, NodeType, NodeStatus,
  NodeContext, NodeExecutor, WorkflowResult,
} from './types';

export class WorkflowGraph {
  private nodes = new Map<string, WorkflowNode>();
  private adjList = new Map<string, string[]>(); // from → to[]
  private entryNodeId: string | null = null;

  /** 添加节点 */
  addNode(id: string, type: NodeType, config: Record<string, unknown> = {}): this {
    const node: WorkflowNode = { id, type, status: 'pending', config };
    this.nodes.set(id, node);

    // 第一个添加的节点默认为入口
    if (!this.entryNodeId) {
      this.entryNodeId = id;
    }

    return this;
  }

  /** 添边 */
  addEdge(from: string, to: string): this {
    if (!this.nodes.has(from)) throw new Error(`Node "${from}" not found`);
    if (!this.nodes.has(to)) throw new Error(`Node "${to}" not found`);

    const edges = this.adjList.get(from) || [];
    edges.push(to);
    this.adjList.set(from, edges);
    return this;
  }

  /** 设置入口节点 */
  setEntry(nodeId: string): this {
    if (!this.nodes.has(nodeId)) throw new Error(`Node "${nodeId}" not found`);
    this.entryNodeId = nodeId;
    return this;
  }

  /** 获取图定义 */
  getDef(): WorkflowGraphDef {
    const edges = [];
    for (const [from, tos] of this.adjList) {
      for (const to of tos) {
        edges.push({ from, to });
      }
    }

    return {
      nodes: Array.from(this.nodes.values()),
      edges,
      entryNodeId: this.entryNodeId || '',
    };
  }

  /** 获取节点 */
  getNode(id: string): WorkflowNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * 拓扑排序
   *
   * 返回节点的拓扑顺序，用于顺序执行。
   * 如果图中存在循环，抛出错误。
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];

    // 初始化入度
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const [, tos] of this.adjList) {
      for (const to of tos) {
        inDegree.set(to, (inDegree.get(to) || 0) + 1);
      }
    }

    // 入度为 0 的节点入队
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      const tos = this.adjList.get(nodeId) || [];
      for (const to of tos) {
        const newDegree = (inDegree.get(to) || 1) - 1;
        inDegree.set(to, newDegree);
        if (newDegree === 0) queue.push(to);
      }
    }

    if (result.length !== this.nodes.size) {
      throw new Error('Workflow graph contains a cycle');
    }

    return result;
  }

  /**
   * 执行工作流
   *
   * @param executors - 节点执行器映射（nodeType → executor）
   * @param ctx - 执行上下文
   * @returns 执行结果
   */
  async execute(executors: Map<NodeType, NodeExecutor>, ctx: NodeContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const trace: WorkflowResult['trace'] = [];

    try {
      // 按拓扑序执行
      const order = this.topologicalSort();
      let lastOutput = '';

      for (const nodeId of order) {
        if (ctx.signal?.aborted) throw new Error('Workflow aborted');

        const node = this.nodes.get(nodeId)!;
        const executor = executors.get(node.type);
        if (!executor) {
          throw new Error(`No executor for node type "${node.type}"`);
        }

        node.status = 'running';
        const nodeStart = Date.now();

        try {
          const result = await executor.execute(node, ctx);
          node.status = 'completed';
          node.result = result;
          ctx.nodeResults.set(nodeId, result);
          trace.push({ nodeId, type: node.type, status: 'completed', duration: Date.now() - nodeStart });

          if (typeof result === 'string') {
            lastOutput = result;
          }
        } catch (error) {
          node.status = 'failed';
          node.error = error instanceof Error ? error.message : String(error);
          trace.push({ nodeId, type: node.type, status: 'failed', duration: Date.now() - nodeStart, error: node.error });

          // 节点失败 → 整个工作流失败（不继续执行）
          // 后续可以扩展为跳过模式
          throw error;
        }
      }

      return {
        runId: ctx.runId,
        output: lastOutput,
        nodeResults: ctx.nodeResults,
        duration: Date.now() - startTime,
        success: true,
        trace,
      };
    } catch (error) {
      return {
        runId: ctx.runId,
        output: '',
        nodeResults: ctx.nodeResults,
        duration: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        trace,
      };
    }
  }
}

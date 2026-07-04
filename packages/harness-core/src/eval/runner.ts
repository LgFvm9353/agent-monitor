/**
 * Eval Runner — Agent 评估执行器
 *
 * Eval（评估）是 Harness Engineering 的第四层"Govern"的核心组件。
 *
 * 为什么 Agent 需要 Eval？
 * Prompt 即代码——每次修改 System Prompt 都可能改变 Agent 行为。
 * 就像前端有单元测试/集成测试，Agent 也需要回归测试来保证质量。
 *
 * Eval 流程：
 *   数据集 → 批量执行 Agent → 多维度评分 → 结果汇总
 *
 * 评分维度：
 * 1. exact-match: 精确匹配
 * 2. semantic: 语义相似度
 * 3. llm-judge: LLM 作为裁判（最灵活但最贵）
 * 4. custom: 自定义评分函数
 */

import type { EvalDataset, EvalRun, EvalScore, EvalSummary } from '../types';
import type { AgentRunner } from '../agent/runner';
import type { AgentConfig } from '../types';

export type ScorerFunction = (input: string, expected: string | undefined, actual: string) => Promise<EvalScore> | EvalScore;

export class EvalRunner {
  private scorers = new Map<string, ScorerFunction>();

  constructor() {
    // 注册内置评分器
    this.registerScorer('exact-match', exactMatchScorer);
    this.registerScorer('semantic-contains', semanticContainsScorer);
  }

  /** 注册评分器 */
  registerScorer(name: string, scorer: ScorerFunction): void {
    this.scorers.set(name, scorer);
  }

  /**
   * 运行 Eval
   *
   * @param dataset - 评估数据集
   * @param runner - Agent 执行器（使用同一个 Agent 配置）
   * @param config - Agent 基础配置（不含 user input）
   * @returns EvalRun 评估结果
   */
  async run(
    dataset: EvalDataset,
    runner: AgentRunner,
    config: Omit<AgentConfig, 'tools' | 'middleware' | 'memory'>,
  ): Promise<EvalRun> {
    const runId = `eval-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();
    const scores: EvalScore[] = [];

    // 逐条执行评估
    for (const item of dataset.items) {
      const result = await runner.run(item.input, config);

      // 对所有评分器打分
      for (const [scorerName, scorer] of this.scorers) {
        const score = await scorer(item.input, item.expectedOutput, result.output);
        scores.push(score);
      }
    }

    const endTime = Date.now();
    const summary = this.buildSummary(dataset, scores);

    return {
      runId,
      datasetId: dataset.id,
      agentConfig: { ...config, tools: [], middleware: [], memory: undefined },
      scores,
      startTime,
      endTime,
      summary,
    };
  }

  /** 构建评估摘要 */
  private buildSummary(dataset: EvalDataset, scores: EvalScore[]): EvalSummary {
    const passedItems = scores.filter((s) => s.passed).length;
    const scorerAverages: Record<string, number> = {};

    for (const [scorerName] of this.scorers) {
      const scorerScores = scores.filter((s) => s.scorerName === scorerName);
      if (scorerScores.length > 0) {
        scorerAverages[scorerName] =
          scorerScores.reduce((sum, s) => sum + s.score, 0) / scorerScores.length;
      }
    }

    return {
      totalItems: dataset.items.length,
      passedItems,
      passRate: dataset.items.length > 0 ? passedItems / dataset.items.length : 0,
      scorerAverages,
    };
  }
}

/** Eval 数据集管理器 */
export class DatasetManager {
  private datasets = new Map<string, EvalDataset>();

  /** 创建数据集 */
  create(name: string, description?: string): EvalDataset {
    const id = `ds-${Date.now().toString(36)}`;
    const dataset: EvalDataset = {
      id,
      name,
      description,
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.datasets.set(id, dataset);
    return dataset;
  }

  /** 添加评估条目 */
  addItem(datasetId: string, input: string, expectedOutput?: string, labels?: string[]): void {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    dataset.items.push({
      id: `item-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      input,
      expectedOutput,
      labels: labels || [],
    });
    dataset.updatedAt = Date.now();
  }

  /** 批量导入 */
  importItems(
    datasetId: string,
    items: Array<{ input: string; expectedOutput?: string; labels?: string[] }>,
  ): void {
    for (const item of items) {
      this.addItem(datasetId, item.input, item.expectedOutput, item.labels);
    }
  }

  /** 获取数据集 */
  get(id: string): EvalDataset | undefined {
    return this.datasets.get(id);
  }

  /** 列出所有数据集 */
  list(): EvalDataset[] {
    return Array.from(this.datasets.values());
  }

  /** 删除数据集 */
  delete(id: string): void {
    this.datasets.delete(id);
  }
}

// ===== 内置评分器 =====

/** 精确匹配评分器 */
const exactMatchScorer: ScorerFunction = (_input, expected, actual) => {
  if (!expected) {
    return { itemId: '', scorerName: 'exact-match', score: 0, passed: false, details: 'No expected output' };
  }
  const passed = expected.trim() === actual.trim();
  return {
    itemId: '',
    scorerName: 'exact-match',
    score: passed ? 1 : 0,
    passed,
    details: passed ? 'Exact match' : `Expected: "${expected}", got: "${actual}"`,
  };
};

/** 语义包含评分器（简化版） */
const semanticContainsScorer: ScorerFunction = (_input, expected, actual) => {
  if (!expected) {
    return { itemId: '', scorerName: 'semantic-contains', score: 0, passed: false };
  }
  // 检查关键词是否出现在输出中
  const keywords = expected.toLowerCase().split(/\s+/).filter((k) => k.length > 2);
  const actualLower = actual.toLowerCase();
  const matched = keywords.filter((k) => actualLower.includes(k));
  const score = keywords.length > 0 ? matched.length / keywords.length : 0;
  return {
    itemId: '',
    scorerName: 'semantic-contains',
    score,
    passed: score >= 0.6, // 60% 的关键词匹配即通过
    details: `Keywords matched: ${matched.length}/${keywords.length}`,
  };
};

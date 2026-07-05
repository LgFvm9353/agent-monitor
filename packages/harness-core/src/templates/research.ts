/**
 * ResearchAgent — 研究 Agent 模板
 *
 * 专为深度研究任务设计的 Agent，工作流：
 *   Understand → Search → Read → Synthesize → Report
 *
 * @example
 * ```ts
 * const researchAgent = createResearchAgent(adapter, {
 *   searchTool: { name: 'webSearch', execute: async (args) => { ... } },
 * });
 * const result = await researchAgent.run('Research the latest AI trends in 2026', config);
 * ```
 */

import { AgentRunner } from '../agent/runner';
import type { ModelAdapter } from '../agent/types';
import type { AgentConfig } from '../types';

/** 研究 Agent 配置 */
export interface ResearchAgentConfig {
  /** 搜索工具 */
  searchTool?: {
    name: string;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  /** 阅读工具 */
  readTool?: {
    name: string;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  /** 研究深度：shallow (快速) | normal (标准) | deep (深度) */
  depth?: 'shallow' | 'normal' | 'deep';
  /** 自定义 system prompt */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a research agent. Your job is to gather, analyze, and synthesize information.

Workflow:
1. Understand the research question deeply
2. Search for relevant information using available tools
3. Read and extract key facts from sources
4. Synthesize findings into a coherent analysis
5. Produce a well-structured report with citations

Rules:
- Verify facts from multiple sources when possible
- Distinguish between established facts and opinions
- If information is insufficient, be honest about limitations
- Structure reports with clear sections: Background, Findings, Analysis, Conclusion`;

export function createResearchAgent(
  adapter: ModelAdapter,
  config: ResearchAgentConfig = {},
): AgentRunner {
  const runner = new AgentRunner(adapter);

  // 注册搜索工具
  if (config.searchTool) {
    runner.withTools({
      [config.searchTool.name]: {
        execute: config.searchTool.execute,
        description: config.searchTool.description || 'Search the web for information',
        parameters: config.searchTool.parameters || {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
    });
  }

  // 注册阅读工具
  if (config.readTool) {
    runner.withTools({
      [config.readTool.name]: {
        execute: config.readTool.execute,
        description: config.readTool.description || 'Read content from a URL',
        parameters: config.readTool.parameters || {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to read' } },
          required: ['url'],
        },
      },
    });
  }

  // 根据深度设置 maxSteps
  const depthSteps = {
    shallow: 5,
    normal: 12,
    deep: 25,
  };

  // 包装 run 方法以注入 research prompt
  const originalRun = runner.run.bind(runner);
  runner.run = async function (userMessage, cfg) {
    const researchCfg: Omit<AgentConfig, 'tools' | 'middleware' | 'memory'> = {
      model: cfg.model,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature ?? 0.3, // 研究任务用较低 temperature
    };
    return originalRun(userMessage, researchCfg);
  };

  return runner;
}

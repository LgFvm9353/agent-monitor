/**
 * CodingAgent — 编码 Agent 模板
 *
 * 专为软件开发任务设计的 Agent，工作流：
 *   Read → Plan → Code → Verify → Refine
 *
 * @example
 * ```ts
 * const codingAgent = createCodingAgent(adapter, {
 *   readFile: { name: 'read_file', execute: async (args) => { ... } },
 *   writeFile: { name: 'write_file', execute: async (args) => { ... } },
 *   runCommand: { name: 'run_command', execute: async (args) => { ... } },
 * });
 * ```
 */

import { AgentRunner } from '../agent/runner';
import type { ModelAdapter } from '../agent/types';

const CODING_SYSTEM_PROMPT = `You are a coding agent. Your job is to write, modify, and debug code.

Workflow:
1. Understand the task — read existing code before making changes
2. Plan your approach — think about the architecture before writing
3. Implement — write clean, working code that follows existing patterns
4. Verify — check your work, run tests if available
5. Refine — fix issues, improve quality

Rules:
- Always read files before editing them
- Match the existing code style (indentation, naming, comments)
- Keep changes minimal — don't refactor unrelated code
- Write clear commit-message style descriptions of changes
- If a command fails, analyze the error before retrying`;

/** 编码 Agent 工具配置 */
export interface CodingAgentConfig {
  readFile?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  writeFile?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  runCommand?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  searchCode?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  systemPrompt?: string;
}

export function createCodingAgent(adapter: ModelAdapter, config: CodingAgentConfig = {}): AgentRunner {
  const runner = new AgentRunner(adapter);

  const tools: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; description: string; parameters: Record<string, unknown> }> = {};

  if (config.readFile) {
    tools[config.readFile.name] = {
      execute: config.readFile.execute,
      description: 'Read a file from the filesystem',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
  }
  if (config.writeFile) {
    tools[config.writeFile.name] = {
      execute: config.writeFile.execute,
      description: 'Write content to a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    };
  }
  if (config.runCommand) {
    tools[config.runCommand.name] = {
      execute: config.runCommand.execute,
      description: 'Run a shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    };
  }
  if (config.searchCode) {
    tools[config.searchCode.name] = {
      execute: config.searchCode.execute,
      description: 'Search code in the codebase',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    };
  }

  runner.withTools(tools);

  const originalRun = runner.run.bind(runner);
  runner.run = async function (userMessage, cfg) {
    return originalRun(userMessage, {
      model: cfg.model,
      systemPrompt: config.systemPrompt || CODING_SYSTEM_PROMPT,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature ?? 0.2,
    });
  };

  return runner;
}

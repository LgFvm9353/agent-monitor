/**
 * DebugAgent — 调试 Agent 模板
 *
 * 专为代码调试设计的 Agent，工作流：
 *   Reproduce → Diagnose → Fix → Verify → Close
 */

import { AgentRunner } from '../agent/runner';
import type { ModelAdapter } from '../agent/types';

const DEBUG_SYSTEM_PROMPT = `You are a debugging agent. Your job is to diagnose and fix bugs.

Workflow:
1. Reproduce — understand the bug and reproduce the error
2. Diagnose — use scientific method: form hypothesis, test, refine
3. Fix — implement the minimal fix
4. Verify — confirm the fix works, check for regressions
5. Close — explain root cause and prevention

Rules:
- Read error messages and stack traces carefully
- Form one hypothesis at a time, test it before moving on
- Use bisection to narrow down the cause
- The simplest explanation is usually correct
- After fixing, explain WHY the bug happened, not just WHAT you changed`;

export interface DebugAgentConfig {
  readFile?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  searchLogs?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  runTests?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  writeFile?: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> };
  systemPrompt?: string;
}

export function createDebugAgent(adapter: ModelAdapter, config: DebugAgentConfig = {}): AgentRunner {
  const runner = new AgentRunner(adapter);

  const tools: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; description: string; parameters: Record<string, unknown> }> = {};

  if (config.readFile) {
    tools[config.readFile.name] = {
      execute: config.readFile.execute,
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
  }
  if (config.searchLogs) {
    tools[config.searchLogs.name] = {
      execute: config.searchLogs.execute,
      description: 'Search logs for errors',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    };
  }
  if (config.runTests) {
    tools[config.runTests.name] = {
      execute: config.runTests.execute,
      description: 'Run test suite',
      parameters: { type: 'object', properties: { testPattern: { type: 'string' } } },
    };
  }
  if (config.writeFile) {
    tools[config.writeFile.name] = {
      execute: config.writeFile.execute,
      description: 'Write a fix to a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    };
  }

  runner.withTools(tools);

  const originalRun = runner.run.bind(runner);
  runner.run = async function (userMessage, cfg) {
    return originalRun(userMessage, {
      model: cfg.model,
      systemPrompt: config.systemPrompt || DEBUG_SYSTEM_PROMPT,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature ?? 0.2,
    });
  };

  return runner;
}

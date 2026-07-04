/**
 * Memory Manager — Agent 记忆管理
 *
 * 管理 Agent 的对话上下文，提供：
 * 1. 对话历史管理（buffer / summary 两种策略）
 * 2. 上下文窗口控制（防止超出 token 限制）
 * 3. 对话摘要压缩
 *
 * 记忆系统是 Agent 区别于一问一答的关键：
 * Agent 能"记住"之前发生了什么，从而进行多轮推理。
 */

import type { MemoryConfig } from '../types';
import type { AgentMessage } from '../agent/types';

const DEFAULT_MAX_TURNS = 10;

export class MemoryManager {
  private history: AgentMessage[] = [];
  private config: MemoryConfig = { type: 'buffer', maxTurns: DEFAULT_MAX_TURNS };
  private summary = '';

  configure(config?: MemoryConfig): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /** 添加对话 */
  addMessage(msg: AgentMessage): void {
    this.history.push(msg);
    this.trim();
  }

  /** 批量添加 */
  addMessages(msgs: AgentMessage[]): void {
    this.history.push(...msgs);
    this.trim();
  }

  /** 获取对话历史（用于注入 LLM 上下文） */
  getHistory(): AgentMessage[] {
    if (this.config.type === 'summary' && this.summary) {
      // 摘要模式：system prompt 加入摘要，只保留最近几轮
      const recentTurns = this.config.maxTurns ?? 3;
      return [
        { role: 'system', content: `Previous conversation summary:\n${this.summary}` },
        ...this.history.slice(-recentTurns * 2), // 每轮 2 条消息
      ];
    }
    return [...this.history];
  }

  /** 清空记忆 */
  clear(): void {
    this.history = [];
    this.summary = '';
  }

  /** 获取统计 */
  getStats(): { messageCount: number; hasSummary: boolean } {
    return {
      messageCount: this.history.length,
      hasSummary: this.summary.length > 0,
    };
  }

  /** 设置摘要（通常由外部 LLM 生成） */
  setSummary(summary: string): void {
    this.summary = summary;
  }

  // ===== 私有方法 =====

  /** 裁剪超出限制的消息 */
  private trim(): void {
    const maxMessages = (this.config.maxTurns ?? DEFAULT_MAX_TURNS) * 2; // 每轮 user + assistant

    if (this.history.length > maxMessages) {
      // 保留最近的消息，旧消息生成摘要
      const removed = this.history.splice(0, this.history.length - maxMessages);
      this.generateSummary(removed);
    }
  }

  /** 为被裁剪的消息生成摘要 */
  private generateSummary(removed: AgentMessage[]): void {
    // 简化版：拼接旧消息的内容作为粗略摘要
    // 生产环境中应使用 LLM 生成摘要
    const content = removed
      .filter((m) => m.role !== 'system')
      .map((m) => `[${m.role}]: ${m.content?.substring(0, 200)}`)
      .join('\n');

    if (content) {
      this.summary = content;
    }
  }
}

/**
 * Memory Manager — Agent 记忆管理
 *
 * 管理 Agent 的对话上下文，提供：
 * 1. 对话历史管理（buffer / summary 两种策略）
 * 2. 上下文窗口控制（防止超出 token 限制）
 * 3. 对话摘要压缩（摘要模式下降本 50-70%）
 *
 * 记忆系统是 Agent 区别于一问一答的关键：
 * Agent 能"记住"之前发生了什么，从而进行多轮推理。
 *
 * 压缩流程（由外部 Orchestrator 驱动）：
 *   needsCompression() → true
 *     → getCompressibleMessages() → 传给 LLM 生成摘要
 *     → applyCompression(summary)  → 替换旧消息
 *
 * 不直接依赖 LLM — 摘要生成由调用方（AgentService）负责。
 */

import type { MemoryConfig } from '../types';
import type { AgentMessage } from '../agent/types';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_KEEP_RECENT = 5;

export class MemoryManager {
  private history: AgentMessage[] = [];
  private config: MemoryConfig = { type: 'buffer', maxTurns: DEFAULT_MAX_TURNS };
  private summary = '';

  /** Token 上限 — 超出时 needsCompression() 返回 true */
  private maxTokens = DEFAULT_MAX_TOKENS;
  /** 压缩后保留最近 N 轮完整消息 */
  private keepRecentTurns = DEFAULT_KEEP_RECENT;

  configure(config?: MemoryConfig): void {
    if (config) {
      this.config = { ...this.config, ...config };
      if (config.maxTokens !== undefined) {
        this.maxTokens = config.maxTokens;
      }
      if (config.maxTurns !== undefined) {
        if (this.config.type === 'summary') {
          this.keepRecentTurns = config.maxTurns;
        }
      }
    }
  }

  /** 添加对话 */
  addMessage(msg: AgentMessage): void {
    this.history.push(msg);
    if (this.config.type === 'buffer') {
      this.trim();
    }
    // 摘要模式不自动 trim — 由外部调用 compress 触发
  }

  /** 批量添加 */
  addMessages(msgs: AgentMessage[]): void {
    this.history.push(...msgs);
    if (this.config.type === 'buffer') {
      this.trim();
    }
  }

  /** 获取对话历史（用于注入 LLM 上下文） */
  getHistory(): AgentMessage[] {
    if (this.config.type === 'summary' && this.summary) {
      // 摘要模式：system prompt 加入摘要，只保留最近几轮
      const recentTurns = this.keepRecentTurns;
      const recent = this.history.slice(-recentTurns * 2); // 每轮 2 条消息(user+assistant)
      return [
        { role: 'system', content: `[对话摘要]\n${this.summary}` },
        ...recent,
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
  getStats(): { messageCount: number; hasSummary: boolean; estimatedTokens: number } {
    return {
      messageCount: this.history.length,
      hasSummary: this.summary.length > 0,
      estimatedTokens: this.estimateTotalTokens(),
    };
  }

  /** 设置摘要 */
  setSummary(text: string): void {
    this.summary = text;
  }

  // ===== 摘要压缩（由外部 Orchestrator 驱动） =====

  /** 是否需要压缩 — token 估算值超限时触发 */
  needsCompression(): boolean {
    if (this.config.type !== 'summary') return false;
    return this.estimateTotalTokens() > this.maxTokens;
  }

  /** 获取可被压缩的消息（超出保留范围的部分） */
  getCompressibleMessages(): AgentMessage[] {
    const keepCount = this.keepRecentTurns * 2; // 每轮 user + assistant
    if (this.history.length <= keepCount) return [];
    return this.history.slice(0, this.history.length - keepCount);
  }

  /** 应用压缩 — 用 LLM 生成的摘要替换旧消息 */
  applyCompression(llmSummary: string): void {
    const keepCount = this.keepRecentTurns * 2;
    if (this.history.length <= keepCount) return;

    const beforeCount = this.history.length;
    const beforeTokens = this.estimateTotalTokens();

    // 保留最近的消息，其余用摘要替换
    this.history = this.history.slice(-keepCount);
    this.summary = llmSummary;

    console.log(
      `[MemoryManager] Compressed: ${beforeCount} msg (${beforeTokens} tokens) → ${this.history.length} recent + summary (${llmSummary.length} chars, ~${this.estimateTokens(llmSummary)} tokens)`,
    );
  }

  /** 获取压缩配置信息 */
  getCompressionConfig(): {
    maxTokens: number; currentTokens: number; keepRecent: number; messageCount: number;
  } {
    return {
      maxTokens: this.maxTokens,
      currentTokens: this.estimateTotalTokens(),
      keepRecent: this.keepRecentTurns,
      messageCount: this.history.length,
    };
  }

  // ===== 私有方法 =====

  /** 粗略 Token 估算（英文：~4 chars/token，中文：~1.5 chars/token） */
  private estimateTokens(text: string): number {
    const latinChars = (text.match(/[a-zA-Z0-9\s]/g) || []).length;
    const otherChars = text.length - latinChars;
    return Math.ceil(latinChars / 4 + otherChars / 1.5);
  }

  /** 估算总 token 数 */
  private estimateTotalTokens(): number {
    let total = this.summary ? this.estimateTokens(this.summary) : 0;
    for (const msg of this.history) {
      total += this.estimateTokens(msg.content || '');
      if (msg.toolCalls) {
        total += this.estimateTokens(JSON.stringify(msg.toolCalls));
      }
    }
    return total;
  }

  /** 裁剪超出限制的消息（buffer 模式） */
  private trim(): void {
    const maxMessages = (this.config.maxTurns ?? DEFAULT_MAX_TURNS) * 2;

    if (this.history.length > maxMessages) {
      const removed = this.history.splice(0, this.history.length - maxMessages);
      this.generateCrudeSummary(removed);
    }
  }

  /** 为被裁剪的消息生成粗略摘要（无 LLM 时的降级方案） */
  private generateCrudeSummary(removed: AgentMessage[]): void {
    const content = removed
      .filter((m) => m.role !== 'system')
      .map((m) => `[${m.role}]: ${(m.content || '').substring(0, 200)}`)
      .join('\n');

    if (content) {
      this.summary = content;
    }
  }
}

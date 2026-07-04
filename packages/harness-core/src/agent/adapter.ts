/**
 * Model Adapter — 模型适配器
 *
 * 提供统一的模型调用接口，屏蔽不同 LLM 提供商的差异。
 *
 * 内置适配器：
 * - OpenAI (包括兼容 OpenAI API 的 DeepSeek、Kimi 等)
 * - Anthropic (Claude)
 */

import type { ModelAdapter, ModelOptions, ModelResponse, ModelStreamChunk, AgentMessage, ToolCall } from './types';
import type { ToolDefinition } from '../types';

// ===== Stream Accumulator =====

/**
 * 流式 Tool Call 累积器
 *
 * 统一 OpenAI 和 Anthropic 在 SSE 流式传输中 tool call 的累积逻辑。
 *
 * OpenAI 的 tool call delta 按 index 分片到达：
 *   第1帧: { index: 0, id: "call_xxx", function: { name: "search", arguments: "" } }
 *   第2帧: { index: 0, function: { arguments: "{\"qu" } }
 *   第3帧: { index: 0, function: { arguments: "ery\": \"hello\"}" } }
 *
 * Anthropic 的 tool use delta 按 content_block 事件到达：
 *   content_block_start: { type: "tool_use", id: "toolu_xxx", name: "search" }
 *   content_block_delta:  { type: "input_json_delta", partial_json: "{\"qu" }
 *   content_block_stop:   index 标记结束
 */
export class StreamAccumulator {
  /** 按 tool call index 累积的 tool calls */
  private pending = new Map<string, {
    id: string;
    name: string;
    argsFragments: string[];
  }>();

  /**
   * 处理 OpenAI 格式的 tool call delta
   */
  addOpenAIDelta(delta: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }): void {
    const key = String(delta.index ?? 0);

    let entry = this.pending.get(key);
    if (!entry) {
      entry = { id: '', name: '', argsFragments: [] };
      this.pending.set(key, entry);
    }

    if (delta.id) entry.id = delta.id;
    if (delta.function?.name) entry.name = delta.function.name;
    if (delta.function?.arguments) {
      entry.argsFragments.push(delta.function.arguments);
    }
  }

  /**
   * 处理 Anthropic 格式的 content_block 事件
   */
  addAnthropicEvent(event: {
    type: 'content_block_start' | 'content_block_delta' | 'content_block_stop';
    index?: number;
    content_block?: {
      type: string;
      id?: string;
      name?: string;
    };
    delta?: {
      type: string;
      partial_json?: string;
      text?: string;
    };
  }): void {
    const key = String(event.index ?? 0);

    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const entry = { id: event.content_block.id || '', name: event.content_block.name || '', argsFragments: [] as string[] };
      this.pending.set(key, entry);
    }

    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const entry = this.pending.get(key);
      if (entry && event.delta.partial_json) {
        entry.argsFragments.push(event.delta.partial_json);
      }
    }
  }

  /**
   * 获取并清除所有已累积完成的 tool calls
   */
  drain(): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const [, tc] of this.pending) {
      if (tc.name) {
        const argsStr = tc.argsFragments.join('');
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsStr);
        } catch {
          // 参数可能不完整（流中断），使用原始字符串
          args = { _raw: argsStr };
        }
        calls.push({ id: tc.id, name: tc.name, arguments: args });
      }
    }
    this.reset();
    return calls;
  }

  /**
   * 获取当前所有 tool calls（不清除）
   */
  peek(): Array<{ index: string; id: string; name: string; argsStr: string }> {
    const result: Array<{ index: string; id: string; name: string; argsStr: string }> = [];
    for (const [key, tc] of this.pending) {
      result.push({ index: key, id: tc.id, name: tc.name, argsStr: tc.argsFragments.join('') });
    }
    return result;
  }

  /** 是否正在积累 tool call */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** 重置累积器 */
  reset(): void {
    this.pending.clear();
  }
}

// ===== OpenAI 适配器 =====

interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  modelId: string;
}

export function createOpenAIAdapter(config: OpenAIConfig): ModelAdapter {
  const baseURL = config.baseURL || 'https://api.openai.com/v1';

  return {
    modelId: config.modelId,
    provider: 'openai',

    async chat(messages: AgentMessage[], options?: ModelOptions): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: config.modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCalls && { tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })) }),
          ...(m.toolCallId && { tool_call_id: m.toolCallId }),
          ...(m.name && { name: m.name }),
        })),
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
      };

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${JSON.stringify(data)}`);
      }

      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;

      return {
        content: (message?.content as string) || '',
        toolCalls: ((message?.tool_calls as Array<Record<string, unknown>>) || []).map((tc: Record<string, unknown>) => ({
          id: tc.id as string,
          name: (tc.function as Record<string, string>).name,
          arguments: JSON.parse((tc.function as Record<string, string>).arguments || '{}'),
        })),
        finishReason: (choice?.finish_reason as ModelResponse['finishReason']) || 'stop',
        usage: {
          inputTokens: (data.usage as Record<string, number>)?.prompt_tokens || 0,
          outputTokens: (data.usage as Record<string, number>)?.completion_tokens || 0,
        },
      };
    },

    async *chatStream(
      messages: AgentMessage[],
      options?: ModelOptions,
    ): AsyncGenerator<ModelStreamChunk> {
      const body: Record<string, unknown> = {
        model: config.modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCalls && { tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })) }),
        })),
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        stream: true,
        // OpenAI 要求 stream_options 来在流式响应中返回 usage
        stream_options: { include_usage: true },
      };

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI stream API error (${response.status}): ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const accumulator = new StreamAccumulator();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              // 流结束：产出累积的 tool calls
              const toolCalls = accumulator.drain();
              if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  yield { toolCallDelta: tc };
                }
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              const delta = choice?.delta;

              // 文本 delta
              if (delta?.content) {
                yield { content: delta.content };
              }

              // Tool call delta
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  accumulator.addOpenAIDelta(tc);
                }
              }

              // Finish reason
              if (choice?.finish_reason) {
                yield { finishReason: choice.finish_reason };
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

// ===== Anthropic 适配器 =====

interface AnthropicConfig {
  apiKey: string;
  modelId: string;
}

export function createAnthropicAdapter(config: AnthropicConfig): ModelAdapter {
  return {
    modelId: config.modelId,
    provider: 'anthropic',

    async chat(messages: AgentMessage[], options?: ModelOptions): Promise<ModelResponse> {
      // 提取 system prompt（Anthropic 的 system 是顶层参数）
      const systemMsg = messages.find((m) => m.role === 'system');
      const otherMsgs = messages.filter((m) => m.role !== 'system');

      const body: Record<string, unknown> = {
        model: config.modelId,
        max_tokens: options?.maxTokens || 4096,
        messages: otherMsgs.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };

      if (systemMsg) {
        body.system = systemMsg.content;
      }

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${JSON.stringify(data)}`);
      }

      const content = data.content as Array<Record<string, unknown>>;
      const textBlock = content.find((c) => c.type === 'text');
      const toolBlocks = content.filter((c) => c.type === 'tool_use');

      return {
        content: (textBlock?.text as string) || '',
        toolCalls: toolBlocks.map((tb) => ({
          id: tb.id as string,
          name: tb.name as string,
          arguments: (tb.input as Record<string, unknown>) || {},
        })),
        finishReason: (data.stop_reason as string) === 'tool_use' ? 'tool_calls' : 'stop',
        usage: {
          inputTokens: (data.usage as Record<string, number>)?.input_tokens || 0,
          outputTokens: (data.usage as Record<string, number>)?.output_tokens || 0,
        },
      };
    },

    async *chatStream(
      messages: AgentMessage[],
      options?: ModelOptions,
    ): AsyncGenerator<ModelStreamChunk> {
      const systemMsg = messages.find((m) => m.role === 'system');
      const otherMsgs = messages.filter((m) => m.role !== 'system');

      const body: Record<string, unknown> = {
        model: config.modelId,
        max_tokens: options?.maxTokens || 4096,
        messages: otherMsgs.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
      };

      if (systemMsg) {
        body.system = systemMsg.content;
      }

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic stream API error (${response.status}): ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const accumulator = new StreamAccumulator();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);

              switch (parsed.type) {
                case 'content_block_start': {
                  // Tool use 开始
                  accumulator.addAnthropicEvent({
                    type: 'content_block_start',
                    index: parsed.index,
                    content_block: parsed.content_block,
                  });
                  break;
                }

                case 'content_block_delta': {
                  const delta = parsed.delta;
                  // 文本 delta
                  if (delta?.type === 'text_delta' && delta.text) {
                    yield { content: delta.text };
                  }
                  // Tool use 参数 delta
                  if (delta?.type === 'input_json_delta') {
                    accumulator.addAnthropicEvent({
                      type: 'content_block_delta',
                      index: parsed.index,
                      delta,
                    });
                  }
                  break;
                }

                case 'content_block_stop': {
                  // content block 结束，产出 tool call（如果有）
                  accumulator.addAnthropicEvent({
                    type: 'content_block_stop',
                    index: parsed.index,
                  });
                  break;
                }

                case 'message_delta': {
                  // 消息级别的 delta（如 stop_reason, usage）
                  if (parsed.delta?.stop_reason) {
                    const finishReason: ModelStreamChunk['finishReason'] =
                      parsed.delta.stop_reason === 'tool_use' ? 'tool_calls'
                      : parsed.delta.stop_reason === 'end_turn' ? 'stop'
                      : 'stop';
                    yield { finishReason };
                  }
                  if (parsed.usage) {
                    // Anthropic 在 message_delta 中返回 usage
                  }
                  break;
                }

                case 'message_stop': {
                  // 消息结束：产出所有累积的 tool calls
                  const toolCalls = accumulator.drain();
                  for (const tc of toolCalls) {
                    yield { toolCallDelta: tc };
                  }
                  break;
                }

                case 'ping':
                  // 心跳，忽略
                  break;

                case 'error': {
                  throw new Error(`Anthropic stream error: ${JSON.stringify(parsed.error)}`);
                }
              }
            } catch (err) {
              // 如果是我们抛出的错误，重新抛出
              if (err instanceof Error && err.message.startsWith('Anthropic stream error')) {
                throw err;
              }
              // 其他解析失败忽略
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

/**
 * Model Adapter — 模型适配器
 *
 * 提供统一的模型调用接口，屏蔽不同 LLM 提供商的差异。
 *
 * 内置适配器：
 * - OpenAI (包括兼容 OpenAI API 的 DeepSeek、Kimi 等)
 * - Anthropic (Claude)
 */

import type { ModelAdapter, ModelOptions, ModelResponse, ModelStreamChunk, AgentMessage } from './types';
import type { ToolDefinition } from '../types';

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
        throw new Error(`OpenAI stream API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') return;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  yield { content: delta.content };
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    yield {
                      toolCallDelta: {
                        id: tc.id,
                        name: tc.function?.name,
                        arguments: tc.function?.arguments
                          ? JSON.parse(tc.function.arguments)
                          : {},
                      },
                    };
                  }
                }
                if (parsed.choices?.[0]?.finish_reason) {
                  yield { finishReason: parsed.choices[0].finish_reason };
                }
              } catch {
                // 忽略解析失败的行
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

// ===== Anthropic 适配器（简化版） =====

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
      _messages: AgentMessage[],
      _options?: ModelOptions,
    ): AsyncGenerator<ModelStreamChunk> {
      // Anthropic 流式实现（类似 OpenAI，处理 SSE 事件）
      // 简化实现，生产环境建议使用 Anthropic SDK
      yield { content: 'Anthropic streaming not yet implemented in this adapter' };
    },
  };
}

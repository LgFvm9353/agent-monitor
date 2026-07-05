/**
 * Agent Playground — Agent 调试工作台
 *
 * 提供 Agent 的实时交互调试环境：
 * - System Prompt 编辑器
 * - 模型选择 + 参数调节
 * - 实时对话测试（SSE Streaming）
 * - Tool 开关面板
 */

import { useState, useRef } from 'react';
import { Send, Settings, Loader2, Wrench } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

export function PlaygroundPage() {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [modelId, setModelId] = useState('gpt-4o');
  const [temperature, setTemperature] = useState(0.7);
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = async () => {
    if (!userInput.trim() || loading) return;

    const input = userInput;
    setUserInput('');
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    // 创建一个空的 assistant 消息用于流式填充
    const assistantMsgIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('http://localhost:3001/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          systemPrompt,
          modelId,
          temperature,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            switch (event.type) {
              case 'text-delta':
                // 追加文本到 assistant 消息
                setMessages((prev) => {
                  const updated = [...prev];
                  const msg = updated[assistantMsgIndex];
                  if (msg && msg.role === 'assistant') {
                    updated[assistantMsgIndex] = { ...msg, content: msg.content + event.content };
                  }
                  return updated;
                });
                break;

              case 'tool-call-start':
                setMessages((prev) => [...prev, {
                  role: 'tool',
                  content: `🔧 Calling ${event.name}...`,
                  toolName: event.name,
                }]);
                break;

              case 'tool-result':
                setMessages((prev) => [...prev, {
                  role: 'tool',
                  content: event.error
                    ? `❌ ${event.name}: ${event.error}`
                    : `✅ ${event.name}: ${JSON.stringify(event.result).substring(0, 200)}`,
                  toolName: event.name,
                }]);
                break;

              case 'done':
                // 最终输出已在 text-delta 中累积完毕
                break;

              case 'error':
                setMessages((prev) => [...prev, {
                  role: 'assistant',
                  content: `❌ Error: ${event.message}`,
                }]);
                break;
            }
          } catch {
            // 忽略解析失败
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `❌ Connection error: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-[calc(100vh-100px)] gap-4">
      {/* Configuration Panel */}
      <div className="w-80 flex-shrink-0 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Configuration
        </h3>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">System Prompt</label>
          <textarea
            className="w-full h-48 bg-secondary border border-border rounded-md p-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">Model</label>
          <select
            className="w-full bg-secondary border border-border rounded-md p-2 text-sm"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4o-mini">GPT-4o Mini</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">
            Temperature: {temperature}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">
            <Wrench className="w-3 h-3 inline mr-1" />
            Tools (coming soon)
          </label>
          <div className="space-y-1 opacity-50">
            {['search', 'read_file', 'write_file', 'execute_code'].map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled className="accent-primary" />
                {tool}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-lg">
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Send a message to test the agent...
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg max-w-[85%] ${
                msg.role === 'user'
                  ? 'bg-primary/10 ml-auto'
                  : msg.role === 'tool'
                  ? 'bg-yellow-500/10 border border-yellow-500/20 text-xs font-mono'
                  : 'bg-secondary'
              }`}
            >
              <div className="text-xs text-muted-foreground mb-1">
                {msg.role === 'user' ? 'You' : msg.role === 'tool' ? `Tool: ${msg.toolName || 'unknown'}` : 'Agent'}
              </div>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Agent is thinking...
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 flex gap-2">
          <input
            className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Type a message..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={loading}
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!userInput.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

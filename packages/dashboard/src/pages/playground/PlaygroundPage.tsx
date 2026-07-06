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
import { Send, Settings, Loader2, Wrench, ChevronRight, ChevronDown, Check, X, Square } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Slider } from '../../components/ui/Slider';
import { Badge } from '../../components/ui/Badge';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolId?: string;
  toolStatus?: 'running' | 'done' | 'error';
  toolResult?: unknown;
}

/** 内建可用工具列表 */
const AVAILABLE_TOOLS = [
  { id: 'queryMonitorEvents', label: 'queryMonitorEvents', description: '查询监控事件' },
  { id: 'getMonitorStats', label: 'getMonitorStats', description: '获取监控统计' },
];

/** 根据工具名生成可读的摘要 */
function formatResultSummary(toolName: string, result: unknown): string {
  try {
    if (toolName === 'getMonitorStats') {
      const r = result as { total: number; byType: Record<string, number> };
      if (r?.byType) {
        const parts = Object.entries(r.byType).map(([k, v]) => `${k}: ${v}`);
        return `总计 ${r.total} 条 (${parts.join(' / ')})`;
      }
      return `总计 ${r.total} 条`;
    }
    if (toolName === 'queryMonitorEvents') {
      const r = result as { total: number; events?: Array<{ type: string }> };
      if (r?.events) {
        const types = [...new Set(r.events.map((e) => e.type))].join(' / ');
        return `${r.total} 条事件 (${types})`;
      }
      return `${r.total} 条`;
    }
  } catch { /* fall through */ }
  return JSON.stringify(result).substring(0, 80);
}

const MODELS = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

export function PlaygroundPage() {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [modelId, setModelId] = useState('deepseek-v4-pro');
  const [temperature, setTemperature] = useState(0.7);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set(AVAILABLE_TOOLS.map((t) => t.id)));
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const toolMsgIndices = useRef<Map<string, number>>(new Map());

  const handleSend = async () => {
    if (!userInput.trim() || loading) return;

    const input = userInput;
    setUserInput('');
    resetToolState();
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    const assistantMsgIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.chatStream({
        message: input,
        systemPrompt,
        modelId,
        temperature,
        enabledTools: [...enabledTools],
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
                setMessages((prev) => {
                  const idx = prev.length;
                  toolMsgIndices.current.set(event.id, idx);
                  return [...prev, {
                    role: 'tool',
                    content: '',
                    toolName: event.name,
                    toolId: event.id,
                    toolStatus: 'running',
                  }];
                });
                break;

              case 'tool-result':
                setMessages((prev) => {
                  const idx = toolMsgIndices.current.get(event.id);
                  if (idx === undefined) return prev;
                  const updated = [...prev];
                  const summary = event.error
                    ? event.error
                    : formatResultSummary(event.name, event.result);
                  updated[idx] = {
                    ...updated[idx],
                    content: summary,
                    toolStatus: event.error ? 'error' : 'done',
                    toolResult: event.result,
                  };
                  return updated;
                });
                break;

              case 'done':
                break;

              case 'error':
                setMessages((prev) => [...prev, {
                  role: 'assistant',
                  content: `❌ Error: ${event.message}`,
                }]);
                break;
            }
          } catch {
            // 忽略解析失败的行
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

  const toggleToolExpanded = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const toggleToolEnabled = (toolId: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const resetToolState = () => {
    toolMsgIndices.current.clear();
    setExpandedTools(new Set());
  };

  return (
    <div className="flex h-[calc(100vh-100px)] gap-4">
      {/* Configuration Panel */}
      <div className="w-80 flex-shrink-0 space-y-4 overflow-auto">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          <Settings className="w-4 h-4" />
          Configuration
        </h3>

        {/* System Prompt */}
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">System Prompt</label>
          <Textarea
            className="h-48 font-mono text-sm"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">Model</label>
          <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </div>

        {/* Temperature */}
        <Slider
          label={`Temperature: ${temperature}`}
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
          minLabel="0"
          maxLabel="2"
        />

        {/* Tools */}
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">
            <Wrench className="w-3 h-3 inline mr-1" />
            Tools
          </label>
          <div className="space-y-1.5">
            {AVAILABLE_TOOLS.map((tool) => {
              const enabled = enabledTools.has(tool.id);
              return (
                <label
                  key={tool.id}
                  className={`flex items-center gap-2 text-sm p-1.5 rounded cursor-pointer transition-colors ${
                    enabled ? 'hover:bg-secondary/50' : 'opacity-50 hover:opacity-75'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleToolEnabled(tool.id)}
                    className="accent-primary"
                  />
                  <div>
                    <span className={enabled ? '' : 'line-through'}>{tool.label}</span>
                    <span className="text-xs text-muted-foreground block">{tool.description}</span>
                  </div>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {enabledTools.size} of {AVAILABLE_TOOLS.length} tools enabled
          </p>
        </div>
      </div>

      {/* Chat Area */}
      <Card className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-foreground">
                <Wrench className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-base">Send a message to test the agent...</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            if (msg.role === 'tool') {
              const isExpanded = expandedTools.has(msg.toolId || '');
              const isRunning = msg.toolStatus === 'running';
              const isError = msg.toolStatus === 'error';
              return (
                <div key={i} className="flex justify-start max-w-[85%]">
                  <button
                    onClick={() => msg.toolId && toggleToolExpanded(msg.toolId)}
                    className={`text-xs rounded-lg px-3 py-1.5 border transition-colors text-left ${
                      isError
                        ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20'
                        : 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-foreground">
                      {isRunning ? (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                      ) : isError ? (
                        <X className="w-3 h-3 text-red-500" />
                      ) : (
                        <Check className="w-3 h-3 text-emerald-600" />
                      )}
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                      <span className="font-medium">{msg.toolName}</span>
                      {!isRunning && (
                        <span className="text-sm text-foreground">{msg.content}</span>
                      )}
                    </div>
                    {isExpanded && msg.toolResult != null && (
                      <pre className="mt-1.5 text-xs text-foreground whitespace-pre-wrap max-h-48 overflow-auto bg-secondary rounded p-2">
                        {JSON.stringify(msg.toolResult, null, 2)}
                      </pre>
                    )}
                  </button>
                </div>
              );
            }

            return (
              <div
                key={i}
                className={`p-3 rounded-lg max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-primary/10 ml-auto'
                    : 'bg-secondary'
                }`}
              >
                <div className="text-xs font-medium text-foreground mb-1">
                  {msg.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div className="text-base whitespace-pre-wrap text-foreground">{msg.content}</div>
              </div>
            );
          })}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Agent is thinking...
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="border-t border-border p-3 flex gap-2">
          <Input
            className="flex-1"
            placeholder="Type a message..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={loading}
          />
          {loading ? (
            <Button variant="destructive" onClick={handleStop} size="sm">
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={!userInput.trim()} size="sm">
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

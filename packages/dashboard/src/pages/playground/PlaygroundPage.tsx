/**
 * Agent Playground — Agent 调试工作台
 *
 * 提供 Agent 的实时交互调试环境：
 * - System Prompt 编辑器
 * - 模型选择 + 参数调节
 * - 实时对话测试（SSE Streaming）
 * - Tool 开关面板
 */

import { useState, useRef, useEffect } from 'react';
import { Send, Settings, Loader2, Wrench, ChevronRight, ChevronDown, Check, X, Square, Plus } from 'lucide-react';
import type { RuntimeData, Trace } from '@agenteye/monitor-sdk';
import { api } from '../../lib/api';
import { monitor } from '../../lib/monitor';
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

const STORAGE_SESSION_INDEX = 'playground_sessions';    // JSON: string[]
const STORAGE_CURRENT_SESSION = 'playground_session_id'; // string
const MSG_PREFIX = 'playground_msgs_';                  // + sessionId

function loadSessionIndex(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_INDEX) || '[]'); } catch { return []; }
}
function saveSessionIndex(ids: string[]) {
  localStorage.setItem(STORAGE_SESSION_INDEX, JSON.stringify(ids));
}
function getOrCreateSessionId(): string {
  const stored = localStorage.getItem(STORAGE_CURRENT_SESSION);
  if (stored) return stored;
  const newId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(STORAGE_CURRENT_SESSION, newId);
  // 加入索引
  const idx = loadSessionIndex();
  if (!idx.includes(newId)) { idx.unshift(newId); saveSessionIndex(idx); }
  return newId;
}
function loadMessages(sid: string): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(MSG_PREFIX + sid) || '[]'); } catch { return []; }
}
function saveMessages(sid: string, msgs: ChatMessage[]) {
  try { localStorage.setItem(MSG_PREFIX + sid, JSON.stringify(msgs)); } catch { /* ignore */ }
}

interface SessionInfo {
  sessionId: string;
  title: string;
  messageCount: number;
  lastActive: number;
  modelId: string;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const sid = getOrCreateSessionId();
    return loadMessages(sid);
  });
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const toolMsgIndices = useRef<Map<string, number>>(new Map());
  const [sessionId, setSessionId] = useState<string>(getOrCreateSessionId);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  // 消息变化时自动持久化到 localStorage
  useEffect(() => {
    saveMessages(sessionId, messages);
  }, [messages, sessionId]);

  // 加载会话列表（localStorage 为主源，服务端补充标题等信息）
  useEffect(() => {
    // 先从 localStorage 索引构建基础列表
    const idx = loadSessionIndex();
    const localSessions: SessionInfo[] = idx.map((id) => {
      const msgs = loadMessages(id);
      const firstUserMsg = msgs.find(m => m.role === 'user');
      return {
        sessionId: id,
        title: firstUserMsg ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '') : 'New Chat',
        messageCount: msgs.length,
        lastActive: 0,
        modelId: '',
      };
    });
    // 确保当前 session 在列表中
    if (!localSessions.find(s => s.sessionId === sessionId)) {
      localSessions.unshift({
        sessionId,
        title: 'New Chat',
        messageCount: 0,
        lastActive: Date.now(),
        modelId: '',
      });
    }
    setSessions(localSessions);

    // 服务端补充（标题、模型等），静默失败
    api.getSessions().then((data) => {
      const serverList = data as SessionInfo[];
      if (serverList.length > 0) {
        setSessions((prev) => prev.map((s) => {
          const server = serverList.find((ss: SessionInfo) => ss.sessionId === s.sessionId);
          return server ? { ...s, title: server.title || s.title, messageCount: server.messageCount, modelId: server.modelId } : s;
        }));
      }
    }).catch(() => {});
  }, [sessionId]);

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
    const trace = monitor.createTrace?.({ aiMessageId: `${sessionId}-${Date.now()}` }) as Trace | undefined;
    let hasMarkedFirstChunk = false;

    trace?.start();

    try {
      const response = await api.chatStream({
        message: input,
        systemPrompt,
        modelId,
        temperature,
        sessionId,
        enabledTools: [...enabledTools],
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      let streamEnded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!hasMarkedFirstChunk) {
          trace?.firstChunk();
          hasMarkedFirstChunk = true;
        }
        trace?.recordChunk();

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
                trace?.toolStart(event.name, undefined, event.id);
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
                trace?.toolEnd(event.id, {
                  success: !event.error,
                  error: event.error,
                });
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
                if (Array.isArray(event.runtimeEvents) && event.runtimeEvents.length > 0) {
                  monitor.reportRuntimeEvents?.(event.runtimeEvents as RuntimeData[]);
                }
                trace?.complete();
                // 服务端已确认对话结束，主动终止流读取
                streamEnded = true;
                break;

              case 'error':
                if (Array.isArray(event.runtimeEvents) && event.runtimeEvents.length > 0) {
                  monitor.reportRuntimeEvents?.(event.runtimeEvents as RuntimeData[]);
                }
                trace?.error(event.message);
                setMessages((prev) => [...prev, {
                  role: 'assistant',
                  content: `❌ Error: ${event.message}`,
                }]);
                streamEnded = true;
                break;
            }
          } catch {
            // 忽略解析失败的行
          }
        }

        if (streamEnded) {
          await reader.cancel();
          break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        trace?.abort('user_abort');
        return;
      }
      trace?.error(error instanceof Error ? error.message : String(error));
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `❌ Connection error: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
      // 清理所有仍在 running 状态的 tool 消息，防止孤儿转圈
      setMessages((prev) => prev.map((msg) =>
        msg.role === 'tool' && msg.toolStatus === 'running'
          ? { ...msg, toolStatus: 'done' as const, content: msg.content || '(no result)' }
          : msg,
      ));
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

  const switchSession = (targetId: string) => {
    if (targetId === sessionId) return;
    // 保存当前会话消息
    saveMessages(sessionId, messages);
    // 加载目标会话消息
    const targetMsgs = loadMessages(targetId);
    setMessages(targetMsgs);
    setSessionId(targetId);
    localStorage.setItem(STORAGE_CURRENT_SESSION, targetId);
    resetToolState();
  };

  const handleNewSession = () => {
    setMessages([]);
    resetToolState();
    // 生成新的 sessionId
    const newId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(STORAGE_CURRENT_SESSION, newId);
    const idx = loadSessionIndex();
    idx.unshift(newId);
    saveSessionIndex(idx);
    saveMessages(newId, []);
    setSessionId(newId);
  };

  return (
    <div className="flex h-[calc(100vh-100px)] gap-4">
      {/* Configuration Panel */}
      <div className="w-80 flex-shrink-0 space-y-4 overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <Settings className="w-4 h-4" />
            Configuration
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewSession}
            title="开始新会话（清空记忆）"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Chat
          </Button>
        </div>

        {/* Session List */}
        {sessions.length > 1 && (
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5 uppercase tracking-wider">
              History
            </label>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => switchSession(s.sessionId)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    s.sessionId === sessionId
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-accent border border-transparent'
                  }`}
                >
                  <div className="text-foreground truncate font-medium">{s.title}</div>
                  <div className="text-muted-foreground mt-0.5">
                    {s.messageCount} msgs · {s.modelId}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

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

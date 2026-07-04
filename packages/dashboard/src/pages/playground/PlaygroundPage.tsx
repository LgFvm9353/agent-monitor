/**
 * Agent Playground — Agent 调试工作台
 *
 * 提供 Agent 的实时交互调试环境：
 * - System Prompt 编辑器
 * - 模型选择 + 参数调节
 * - 实时对话测试
 * - Tool 开关面板
 */

import { useState } from 'react';
import { Send, Settings } from 'lucide-react';

export function PlaygroundPage() {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const handleSend = () => {
    if (!userInput.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', content: userInput }]);
    setUserInput('');

    // TODO: 调用 Agent Runner API
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'This is a placeholder response. The Agent Runner API will be integrated here.' },
      ]);
    }, 500);
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
          <select className="w-full bg-secondary border border-border rounded-md p-2 text-sm">
            <option>gpt-4o</option>
            <option>claude-sonnet-4-6</option>
            <option>deepseek-v4-pro</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">Temperature</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            defaultValue="0.7"
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1">Tools</label>
          <div className="space-y-1">
            {['search', 'read_file', 'write_file', 'execute_code'].map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-sm">
                <input type="checkbox" defaultChecked className="accent-primary" />
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
              className={`p-3 rounded-lg max-w-[80%] ${
                msg.role === 'user'
                  ? 'bg-primary/10 ml-auto'
                  : 'bg-secondary'
              }`}
            >
              <div className="text-xs text-muted-foreground mb-1">
                {msg.role === 'user' ? 'You' : 'Agent'}
              </div>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-border p-3 flex gap-2">
          <input
            className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Type a message..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            onClick={handleSend}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

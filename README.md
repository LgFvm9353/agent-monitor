# 🚀 Agent Harness Monitor

> **AI Agent 前端可观测性与 Harness 控制平台** — 从前端工程师的视角观测和控制 AI Agent。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-9.15-orange)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-latest-ef4444)](https://turbo.build/)

---

## 为什么做这个项目？

2025-2026 年，AI 工程经历了三个阶段：

| 阶段 | 时间 | 核心问题 |
|------|------|----------|
| **Prompt Engineering** | 2023 | 告诉 AI 说什么 |
| **Context Engineering** | 2025 | 让 AI 知道什么 |
| **Harness Engineering** ⭐ | **2026** | 如何让 AI Agent **可控、可观测、可回归** |

**核心公式：Agent = Model + Harness**

Harness 是 AI Agent 的基础设施层——工具、状态、规划、记忆、护栏、多智能体协调。但市场上**缺少一个前端视角的 Agent 可观测性方案**。

本项目填补这个空白：将 Agent 的内部运行过程"翻译"为前端工程师能理解的可视化语言（火焰图、时间线、Trace 面板）。

---

## 项目结构

```
agent-harness-monitor/
├── packages/
│   ├── monitor-sdk/     # 📦 前端监控 SDK（错误/性能/行为）
│   ├── harness-core/    # 🧠 Agent Harness 引擎
│   ├── dashboard/       # 📊 可视化 Dashboard (React)
│   ├── server/          # 🔧 NestJS 后端
│   └── types/           # 📝 共享类型定义
├── examples/            # 💡 示例项目
└── docs/                # 📖 VitePress 文档
```

### Part A: 前端监控 SDK (`@agent-harness/monitor-sdk`)

- ✅ 错误追踪（JS Error / Promise Rejection / Resource Error）
- ✅ 性能监控（Core Web Vitals: LCP, FCP, INP, CLS, TTFB）
- ✅ 用户行为采集（Clicks / Route / HTTP 面包屑）
- ✅ 插件化架构（ErrorPlugin / PerformancePlugin / BehaviorPlugin）
- ✅ 可靠上报（sendBeacon + fetch batch + IndexedDB 离线缓存）
- ✅ 错误去重 + 白屏检测

### Part B: Agent Harness 引擎 (`@agent-harness/core`)

- ✅ **Agent Runner** — Agent 执行引擎（思考→工具调用→响应循环）
- ✅ **Tool Registry** — 工具注册中心（MCP 集成）
- ✅ **Middleware Pipeline** — 洋葱模型中间件（Context/Validator/Cost）
- ✅ **Memory System** — 对话历史 + 摘要压缩
- ✅ **Eval Framework** — 数据集 + 多维度评分（exact/semantic/LLM-judge）
- ✅ **Trace System** — OpenTelemetry 兼容的 Agent 执行追踪

### Part B-2: Dashboard 可视化平台

- ✅ **Overview Dashboard** — 核心指标卡片 + 趋势图
- ⭐ **Trace Explorer** — Agent 执行火焰图/时间线（类似 Chrome DevTools Performance）
- ✅ **Eval Dashboard** — 评估数据集管理 + 评分对比
- ✅ **Agent Playground** — System Prompt 编辑 + 实时对话测试
- ✅ **Frontend Monitor** — Dashboard 自身监控（食狗粮）

### Part B-3: NestJS 后端

- ✅ REST API（Trace / Eval / Agent / Monitor）
- ✅ WebSocket 实时推送（Trace 流式更新）
- ✅ MySQL 8.0 + Drizzle ORM

---

## 快速开始

### 前置条件

- **Node.js** >= 18
- **pnpm** >= 9
- **MySQL** >= 8.0（本地或 Docker）

### 数据库初始化

```bash
# 方式一：直接执行 SQL 脚本
mysql -u root -p < packages/server/init.sql

# 方式二：Docker 快速启动
docker run -d --name mysql-agent \\
  -e MYSQL_ROOT_PASSWORD=root \\
  -e MYSQL_DATABASE=agent_harness_monitor \\
  -p 3306:3306 \\
  mysql:8.0

# 然后执行初始化
mysql -u root -proot -h 127.0.0.1 < packages/server/init.sql
```

### 环境变量

```bash
# 在 packages/server/.env 中配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=agent_harness_monitor

OPENAI_API_KEY=sk-xxx          # Agent 调用所需的 API Key
OPENAI_BASE_URL=https://api.deepseek.com/v1  # DeepSeek 兼容端点
```

### 启动

```bash
# 安装依赖
pnpm install

# 启动所有服务
pnpm dev

# Dashboard → http://localhost:5173
# API Server → http://localhost:3001
# WebSocket → ws://localhost:3001/trace
```

### 单独启动

```bash
# 启动后端
cd packages/server && pnpm dev

# 启动 Dashboard
cd packages/dashboard && pnpm dev

# 构建 SDK
cd packages/monitor-sdk && pnpm build

# 构建 Harness Core
cd packages/harness-core && pnpm build
```

---

## 使用示例

### Monitor SDK

```typescript
import { Monitor, ErrorPlugin, PerformancePlugin, BehaviorPlugin } from '@agent-harness/monitor-sdk';

const monitor = new Monitor({
  reportUrl: 'http://localhost:3001/api/monitor/report',
  appId: 'my-app',
});

monitor.use(new ErrorPlugin());
monitor.use(new PerformancePlugin());
monitor.use(new BehaviorPlugin());
monitor.start();

// 手动上报
monitor.report({
  type: 'custom',
  timestamp: Date.now(),
  data: { name: 'button-click', payload: { buttonId: 'submit' } },
});
```

### Agent Harness Core

```typescript
import { AgentRunner, createOpenAIAdapter } from '@agent-harness/core';

const runner = new AgentRunner(createOpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  modelId: 'gpt-4o',
}));

runner.withTools({
  search: {
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async (args) => {
      // ... search implementation
      return { results: [] };
    },
  },
});

// 监听事件
runner.on('step', (step) => console.log('Step:', step));
runner.on('tool-call', (call) => console.log('Tool:', call.name));
runner.on('done', (result) => console.log('Done:', result.output));

// 执行
const result = await runner.run('帮我分析这段代码', {
  model: 'gpt-4o',
  systemPrompt: '你是一个代码分析专家...',
});

console.log(result.output);
console.log(`Tokens: ${result.tokens.total} | Duration: ${result.duration}ms`);
console.log(`Tool calls: ${result.toolCalls.length}`);
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| SDK | TypeScript + Rollup |
| Harness Core | TypeScript (纯库，零框架依赖) |
| Dashboard | React 18 + Vite + TailwindCSS + Zustand |
| Backend | NestJS + Drizzle ORM + MySQL |
| Monorepo | pnpm workspace + Turborepo |
| Real-time | WebSocket (Socket.IO) |
| Test | Vitest + Playwright |

---

## 对 Agent 理解的体现

本项目通过对以下核心概念的实现，展示了对 AI Agent 的深入理解：

1. **Agent 执行循环**（Agent Runner）：Agent 不是一次 LLM 调用，而是「思考→行动→观察→再思考」的 ReAct 循环
2. **工具调用**（Tool Registry）：Agent 通过工具与外部世界交互的能力是其区别于 ChatBot 的关键
3. **中间件模式**（Middleware Pipeline）：类比 Koa/Express 洋葱模型，Agent 的能力通过可组合的中间件装配
4. **可观测性**（Trace）：类似前端 Performance API，Agent 的每一步都需要可观测才能调试优化
5. **评估体系**（Eval）：Prompt 即代码，每次修改都需要回归测试——Agent 也需要"单元测试"
6. **记忆管理**（Memory）：Agent 能记住上下文，这是多轮推理的基础

---

## 许可证

MIT License

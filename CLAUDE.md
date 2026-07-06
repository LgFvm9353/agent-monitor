# CLAUDE.md — Agent Harness Monitor 开发指南

## 项目概述

`agent-harness-monitor` 是一个从前端工程师视角观测和控制 AI Agent 的开源平台。结合前端监控 SDK + Agent Harness 引擎 + 可视化 Dashboard。

## 技术栈

- **Monorepo**: pnpm workspace + Turborepo
- **语言**: TypeScript (全栈)
- **SDK 构建**: Rollup
- **Dashboard**: React 18 + Vite + TailwindCSS + Zustand + shadcn/ui
- **Backend**: NestJS + Drizzle ORM + MySQL
- **实时通信**: WebSocket (Socket.IO)

## 项目结构

```
packages/
├── types/         # @agent-harness/types — 共享类型
├── monitor-sdk/   # @agent-harness/monitor-sdk — 前端监控SDK
├── harness-core/  # @agent-harness/core — Agent Harness引擎
├── dashboard/     # @agent-harness/dashboard — 可视化平台
└── server/        # @agent-harness/server — NestJS后端
```

## 常用命令

```bash
pnpm install        # 安装所有依赖
pnpm dev            # 启动所有服务（Turborepo）
pnpm build          # 构建所有包
pnpm test           # 运行所有测试
pnpm lint           # 代码检查
```

### 单独运行

```bash
# 后端
cd packages/server && pnpm dev

# Dashboard
cd packages/dashboard && pnpm dev

# SDK 构建
cd packages/monitor-sdk && pnpm build

# Core 构建
cd packages/harness-core && pnpm build
```

## 架构约定

### 包依赖关系

```
types ← monitor-sdk
types ← harness-core
types ← server → harness-core
dashboard → monitor-sdk, types
```

### 命名规范

- 文件名: kebab-case（如 `error-id.ts`, `trace-store.ts`）
- 类名: PascalCase（如 `AgentRunner`, `ToolRegistry`）
- 函数/变量: camelCase（如 `generateErrorId`, `createTracer`）
- 类型/接口: PascalCase（如 `MonitorEvent`, `AgentConfig`）
- 常量: UPPER_SNAKE_CASE（如 `DEFAULT_BATCH_SIZE`）

### 代码风格

- 所有公开 API 必须有 JSDoc 注释
- 优先使用 `interface` 而非 `type`（除非需要 union/intersection）
- 避免 `any`，使用 `unknown` 或泛型
- 插件遵循生命周期模式: setup → collect → destroy

## 关键设计决策

1. **插件系统**: Monitor SDK 采用插件架构，每种监控能力（错误/性能/行为）作为独立插件
2. **洋葱模型**: Middleware Pipeline 模仿 Koa/Express 的中间件模式
3. **Agent 循环**: Agent Runner 实现 ReAct 模式（Reasoning + Acting）
4. **OpenTelemetry 兼容**: Trace 系统兼容 OTel Span 语义

## 测试策略

- SDK: Vitest (单元) + Playwright (E2E，浏览器环境)
- Core: Vitest (纯 Node.js，模拟 LLM 响应)
- Server: Jest (NestJS 集成测试)
- Dashboard: 手动验证 + 可选 Vitest

## 文档

- 项目详细规划: `../plans/buzzing-seeking-crystal.md`
- README: 项目入口文档
- API 文档: 后续 VitePress 生成

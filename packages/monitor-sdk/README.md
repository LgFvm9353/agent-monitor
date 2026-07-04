# @agenteye/monitor-sdk

AI Agent 前端可观测性 SDK — 从前端工程师视角监控 AI 应用的运行状态。

## 为什么需要这个 SDK？

市面上的前端监控 SDK（Sentry、LogRocket 等）只覆盖 JS 错误和页面性能，完全没有 AI Agent 的 SSE 流追踪能力。极少数支持 AI Trace 的 SDK 又缺少面包屑、白屏检测、慢请求诊断等前端排查手段——**你只能选择看前端或看 Agent，没法把两者串起来**。

但实际上，用户的一次操作可能触发 JS 异常导致 Agent 工具调用失败，或者 Agent 流卡顿让页面白屏——前端的 Bug 和后端的推理链路是关联的。

**这个 SDK 把前端监控和 AI Agent Trace 打通，填补了这个断层。**

## 能力概览

| 分类 | 能力 |
|------|------|
| **错误追踪** | JS 运行时错误、Promise 未处理拒绝、静态资源加载失败、console.error 劫持、基于堆栈签名的错误去重 |
| **性能监控** | Core Web Vitals (LCP/FCP/CLS/INP/TTFB)、Navigation Timing (DNS/TCP/请求/解析全链路)、Long Task 检测、白屏检测 |
| **用户行为** | 点击事件 (XPath + 面包屑)、SPA 路由变化 (Hash + History API)、Fetch/XHR 拦截 (慢请求 >1s 和错误 status ≥400)、PV 统计 |
| **SSE Trace** | Agent 流式响应全生命周期追踪：TTFB/TTLB、阶段耗时、工具调用链路 (参数/结果/耗时)、停顿检测 (5s 无数据告警)、图片加载追踪、重试链关联 |
| **传输保障** | 三级优先级队列 (high/normal/low)、三种发送模式 (immediate/throttle/batch)、IndexedDB 写前日志、pagehide + sendBeacon 卸载保障、指数退避 + 随机抖动重试 |

## 安装

```bash
npm install @agenteye/monitor-sdk
```

## 上报数据格式

SDK 以 `POST` 请求将 JSON 数组批量发送到配置的 `reportUrl`。每条事件的格式如下：

```json
{
  "eventId": "mh7xabc-1",
  "type": "error | performance | behavior | custom | sse",
  "timestamp": 1751648000000,
  "data": { ... },
  "meta": {
    "url": "http://localhost:5500/",
    "userAgent": "Mozilla/5.0 ...",
    "sessionId": "mh7xabc-xyz",
    "pageId": "/",
    "sdkVersion": "0.1.0",
    "appId": "my-app",
    "tags": {}
  }
}
```

### data 字段按 type 不同

**error** (`ErrorData`)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `errorType` | `'js' \| 'promise' \| 'resource' \| 'console' \| 'http' \| 'custom'` | 错误分类 |
| `message` | `string` | 错误消息 |
| `stack` | `string?` | 完整堆栈 |
| `filename` | `string?` | 出错文件 URL |
| `lineno` | `number?` | 行号 |
| `colno` | `number?` | 列号 |
| `errorId` | `string` | 基于堆栈签名的去重 ID |
| `breadcrumbs` | `Breadcrumb[]` | 错误发生前的用户操作面包屑 |

**performance** (`PerformanceData`)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `perfType` | `'navigation' \| 'resource' \| 'web-vital' \| 'long-task' \| 'custom'` | 性能分类 |
| `lcp` / `fcp` / `cls` / `inp` / `ttfb` | `number?` | Core Web Vitals |
| `dnsTime` / `tcpTime` / `requestTime` / `responseTime` / `domParseTime` / `domReadyTime` / `loadTime` | `number?` | Navigation Timing 各阶段耗时 (ms) |
| `customMetrics` | `Record<string, number>?` | 自定义指标，例如 `longTaskCount`、`longTaskAvg`、`longTaskMax` |

**behavior** (`BehaviorData`)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `behaviorType` | `'click' \| 'route' \| 'http' \| 'console' \| 'custom'` | 行为分类 |
| `tagName` / `className` / `textContent` / `xpath` | `string?` | 点击事件：触发元素的标签、类名、文本、XPath |
| `from` / `to` | `string?` | 路由变化：来源 URL → 目标 URL |
| `method` / `url` / `status` / `duration` | `string?` / `string?` / `number?` / `number?` | HTTP 请求：方法、地址、状态码、耗时 (ms) |

**sse** (`TraceData`) — SSE 流式 Trace 事件：

| 字段 | 类型 | 说明 |
|------|------|------|
| `traceId` | `string` | Trace 唯一 ID |
| `aiMessageId` | `string?` | 关联的 AI 消息 ID |
| `sseType` | `SSETraceEventType` | 事件子类型，见下表 |
| `previousTraceId` | `string?` | 重试场景：前一次 trace 的 ID |
| `ttfb` | `number?` | 首字节时间 (ms) |
| `ttlb` | `number?` | 流完整耗时 (ms) |
| `phase` / `phaseDuration` | `string?` / `number?` | 阶段名和耗时 (ms) |
| `toolCallId` / `toolName` / `toolSuccess` / `toolDuration` | `string?` / `string?` / `boolean?` / `number?` | 工具调用信息 |
| `stallDuration` | `number?` | 停顿持续时长 (ms) |
| `imageUrl` / `imageSize` | `string?` / `number?` | 生成图片的 URL 和加载耗时 |

`sseType` 可选值：

| 值 | 触发时机 | 关键附加字段 |
|------|------|------|
| `sse_start` | SSE 连接建立 | traceId, aiMessageId |
| `sse_first_chunk` | 首字节到达 | ttfb |
| `sse_chunk` | 每个数据块 | — |
| `sse_stall` | 连续无数据超阈值 (默认 5s) | stallDuration |
| `sse_resume` | 从停顿中恢复 | stallDuration |
| `sse_complete` | 流正常结束 | ttlb |
| `sse_error` | 流异常终止 | error, duration |
| `sse_abort` | 用户主动取消 | abortReason, duration |
| `tool_start` | 工具调用开始 | toolCallId, toolName, toolArgs |
| `tool_end` | 工具调用结束 | toolName, toolSuccess, toolDuration, resultCount |
| `phase_start` | 阶段开始 | phase |
| `phase_end` | 阶段结束 | phase, phaseDuration |
| `image_load_start` | 生成图片开始加载 | imageUrl |
| `image_load_complete` | 图片加载完成 | imageUrl, duration, imageSize |
| `image_load_error` | 图片加载失败 | imageUrl, error, duration |
| `user_retry` | 用户重试 (有 previousTraceId) | previousTraceId |

## 后端接收示例

服务端在 `reportUrl` 接收一个 **JSON 数组**，每条元素的结构见上。以 NestJS 为例：

```ts
// POST /api/monitor/report
@Post('report')
async receive(@Body() events: MonitorEvent[]) {
  await this.db.insert(events);
  return { success: true };
}
```

`MonitorEvent` 的完整 TypeScript 类型定义位于 `@agent-harness/types`，也可参考上方字段表格自行定义。

## License

MIT

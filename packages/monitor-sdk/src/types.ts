// ============================================================
// @agenteye/monitor-sdk — 类型定义
// ============================================================

// ---------- 上报事件 ----------

/** 上报数据基础结构 */
export interface MonitorEvent {
  eventId: string;
  type: EventType;
  timestamp: number;
  data: ErrorData | PerformanceData | BehaviorData | CustomData | TraceData;
  meta: EventMeta;
}

export type EventType = 'error' | 'performance' | 'behavior' | 'custom' | 'sse';

export interface EventMeta {
  url: string;
  userAgent: string;
  sessionId: string;
  pageId: string;
  sdkVersion: string;
  appId: string;
  tags?: Record<string, string>;
}

// ---------- 错误事件 ----------

export interface ErrorData {
  errorType: ErrorCategory;
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  errorId: string;
  breadcrumbs?: Breadcrumb[];
}

export type ErrorCategory = 'js' | 'promise' | 'resource' | 'console' | 'http' | 'custom';

// ---------- 性能事件 ----------

export interface PerformanceData {
  perfType: PerfCategory;
  lcp?: number;
  fcp?: number;
  fid?: number;
  inp?: number;
  cls?: number;
  ttfb?: number;
  dnsTime?: number;
  tcpTime?: number;
  requestTime?: number;
  responseTime?: number;
  domParseTime?: number;
  domReadyTime?: number;
  loadTime?: number;
  customMetrics?: Record<string, number>;
}

export type PerfCategory = 'navigation' | 'resource' | 'web-vital' | 'long-task' | 'custom';

// ---------- 用户行为 ----------

export interface BehaviorData {
  behaviorType: BehaviorCategory;
  tagName?: string;
  className?: string;
  textContent?: string;
  xpath?: string;
  from?: string;
  to?: string;
  method?: string;
  url?: string;
  status?: number;
  duration?: number;
  requestBody?: string;
  responseBody?: string;
}

export type BehaviorCategory = 'click' | 'route' | 'http' | 'console' | 'custom';

// ---------- 自定义事件 ----------

export interface CustomData {
  name: string;
  payload: Record<string, unknown>;
}

// ---------- 面包屑 ----------

export interface Breadcrumb {
  type: BehaviorCategory;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ---------- SSE Trace ----------

export type SSETraceEventType =
  | 'sse_start'
  | 'sse_first_chunk'
  | 'sse_chunk'
  | 'sse_stall'
  | 'sse_resume'
  | 'sse_complete'
  | 'sse_error'
  | 'sse_abort'
  | 'tool_start'
  | 'tool_end'
  | 'phase_start'
  | 'phase_end'
  | 'image_load_start'
  | 'image_load_complete'
  | 'image_load_error'
  | 'user_retry';

export interface TraceData {
  traceId: string;
  aiMessageId?: string;
  previousTraceId?: string;
  sseType: SSETraceEventType;
  ttfb?: number;
  ttlb?: number;
  phase?: string;
  phaseDuration?: number;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolSuccess?: boolean;
  toolDuration?: number;
  stallDuration?: number;
  lastChunkTime?: number;
  error?: string;
  abortReason?: string;
  imageUrl?: string;
  imageSize?: number;
  imageWidth?: number;
  imageHeight?: number;
  resultCount?: number;
  sources?: string[];
  duration?: number;
  [key: string]: unknown;
}

export interface TraceOptions {
  aiMessageId?: string;
  previousTraceId?: string;
  stallThreshold?: number;
}

// ---------- Monitor 配置 ----------

export interface SampleRateConfig {
  error?: number;
  performance?: number;
  behavior?: number;
  custom?: number;
}

export interface MonitorConfig {
  reportUrl: string;
  appId: string;
  appVersion?: string;
  enabled?: boolean;
  sampleRate?: number | SampleRateConfig;
  beforeSend?: (event: MonitorEvent) => MonitorEvent | null;
  debug?: boolean;
  plugins?: PluginConfig[];
  transport?: TransportConfig;
  user?: UserInfo;
}

export interface PluginConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface TransportConfig {
  batchSize?: number;
  flushInterval?: number;
  enableOffline?: boolean;
  maxRetries?: number;
  mode?: 'batch' | 'throttle' | 'immediate';
  typeConfig?: Record<string, 'immediate' | 'throttle' | 'batch'>;
  throttleInterval?: number;
  maxBufferSize?: number;
  criticalTypes?: string[];
  baseRetryDelay?: number;
  maxRetryDelay?: number;
  retryJitter?: number;
}

export interface UserInfo {
  userId?: string;
  userName?: string;
  [key: string]: string | undefined;
}

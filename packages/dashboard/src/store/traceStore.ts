/**
 * Trace Store — Zustand 状态管理
 *
 * 管理 Trace Explorer 的所有状态：
 * - Trace 列表
 * - 当前选中的 Trace
 * - 实时 WebSocket 连接
 */
import { create } from 'zustand';

export interface TraceSummary {
  id: string;
  sessionId: string;
  model: string;
  success: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  createdAt: number;
}

export interface SpanData {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: 'agent' | 'llm' | 'tool' | 'middleware';
  startTime: number;
  endTime: number;
  status: string;
  children: SpanData[];
}

interface TraceStore {
  traces: TraceSummary[];
  selectedTraceId: string | null;
  selectedTraceSpans: SpanData[];
  isLoading: boolean;
  isConnected: boolean;

  setTraces: (traces: TraceSummary[]) => void;
  selectTrace: (id: string) => void;
  setSpans: (spans: SpanData[]) => void;
  setLoading: (loading: boolean) => void;
  setConnected: (connected: boolean) => void;
  /** WebSocket 实时追加 Span */
  appendRealtimeSpan: (traceId: string, span: SpanData) => void;
}

export const useTraceStore = create<TraceStore>((set, get) => ({
  traces: [],
  selectedTraceId: null,
  selectedTraceSpans: [],
  isLoading: false,
  isConnected: false,

  setTraces: (traces) => set({ traces }),

  selectTrace: (id) => set({ selectedTraceId: id }),

  setSpans: (spans) => set({ selectedTraceSpans: spans }),

  setLoading: (loading) => set({ isLoading: loading }),

  setConnected: (connected) => set({ isConnected: connected }),

  appendRealtimeSpan: (traceId, span) => {
    const { selectedTraceId, selectedTraceSpans } = get();
    if (selectedTraceId === traceId) {
      set({ selectedTraceSpans: [...selectedTraceSpans, span] });
    }
  },
}));

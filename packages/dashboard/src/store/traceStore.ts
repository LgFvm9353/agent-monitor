/**
 * Trace Store — Zustand 状态管理
 *
 * 管理 Trace Explorer 的所有状态：
 * - Trace 列表
 * - 当前选中的 Trace
 * - 单次 Run 详情（runtime events）
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

/** 兼容旧版 FlameGraph 的 Span 类型，后续可在重构时移除。 */
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

export interface RuntimeEvent {
  id: string;
  traceId: string;
  runId: string;
  parentId?: string | null;
  stepId?: string | null;
  kind: string;
  eventType: string;
  name: string;
  status: string;
  startTime: number;
  endTime?: number | null;
  durationMs?: number | null;
  input?: string | null;
  outputSummary?: string | null;
  error?: string | null;
  metadata?: string | null;
  createdAt: number;
}

export interface RunDetail {
  trace: TraceSummary;
  events: RuntimeEvent[];
}

interface TraceStore {
  traces: TraceSummary[];
  selectedTraceId: string | null;
  selectedTrace: TraceSummary | null;
  selectedRuntimeEvents: RuntimeEvent[];
  selectedEventId: string | null;
  isLoading: boolean;
  isConnected: boolean;
  runDetailError: string | null;

  setTraces: (traces: TraceSummary[]) => void;
  selectTrace: (id: string | null) => void;
  setSelectedTrace: (trace: TraceSummary | null) => void;
  setRuntimeEvents: (events: RuntimeEvent[]) => void;
  selectEvent: (id: string | null) => void;
  setRunDetail: (detail: RunDetail) => void;
  resetRunDetail: () => void;
  setLoading: (loading: boolean) => void;
  setConnected: (connected: boolean) => void;
  setError: (message: string | null) => void;
  appendRealtimeEvent: (traceId: string, event: RuntimeEvent) => void;
}

export const useTraceStore = create<TraceStore>((set, get) => ({
  traces: [],
  selectedTraceId: null,
  selectedTrace: null,
  selectedRuntimeEvents: [],
  selectedEventId: null,
  isLoading: false,
  isConnected: false,
  runDetailError: null,

  setTraces: (traces) => set({ traces }),

  selectTrace: (id) => set({ selectedTraceId: id }),

  setSelectedTrace: (trace) => set({ selectedTrace: trace }),

  setRuntimeEvents: (events) => {
    set({
      selectedRuntimeEvents: events,
      selectedEventId: events[0]?.id ?? null,
    });
  },

  selectEvent: (id) => set({ selectedEventId: id }),

  setRunDetail: (detail) => {
    set({
      selectedTraceId: detail.trace.id,
      selectedTrace: detail.trace,
      selectedRuntimeEvents: detail.events,
      selectedEventId: detail.events[0]?.id ?? null,
      runDetailError: null,
    });
  },

  resetRunDetail: () => {
    set({
      selectedTrace: null,
      selectedRuntimeEvents: [],
      selectedEventId: null,
      runDetailError: null,
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setConnected: (connected) => set({ isConnected: connected }),

  setError: (message) => set({ runDetailError: message }),

  appendRealtimeEvent: (traceId, event) => {
    const { selectedTraceId, selectedRuntimeEvents, selectedEventId } = get();

    if (selectedTraceId !== traceId) {
      return;
    }

    const existingIndex = selectedRuntimeEvents.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) {
      const nextEvents = [...selectedRuntimeEvents];
      nextEvents[existingIndex] = event;
      set({ selectedRuntimeEvents: nextEvents });
      return;
    }

    const nextEvents = [...selectedRuntimeEvents, event].sort((a, b) => a.startTime - b.startTime);
    set({
      selectedRuntimeEvents: nextEvents,
      selectedEventId: selectedEventId ?? event.id,
    });
  },
}));

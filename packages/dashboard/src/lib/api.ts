/**
 * API 请求封装
 */

const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  // 嵌套格式: { code, data, message }
  return json.data || json;
}

export interface ChatRequest {
  message: string;
  systemPrompt?: string;
  modelId?: string;
  apiKey?: string;
  baseURL?: string;
  provider?: 'openai' | 'anthropic';
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
  enabledTools?: string[];
}

export const api = {
  // Trace
  getTraces: (limit = 50) => request(`/traces?limit=${limit}`),
  getTrace: (id: string) => request(`/traces/${id}`),
  getTraceStats: () => request('/traces/stats'),

  // Eval
  getDatasets: () => request('/eval/datasets'),
  getDataset: (id: string) => request(`/eval/datasets/${id}`),
  createDataset: (name: string, description?: string) =>
    request('/eval/datasets', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  addDatasetItem: (datasetId: string, item: { input: string; expectedOutput?: string; labels?: string[] }) =>
    request(`/eval/datasets/${datasetId}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    }),
  getEvalRuns: (datasetId?: string) =>
    request(`/eval/runs${datasetId ? `?datasetId=${datasetId}` : ''}`),

  // Agent Sessions
  getSessions: () => request('/agent/sessions'),
  getSession: (id: string) => request(`/agent/sessions/${id}`),

  // Agent Configs
  getAgentConfigs: () => request('/agent/configs'),
  getAgentConfig: (id: string) => request(`/agent/configs/${id}`),
  createAgentConfig: (name: string, config: Record<string, unknown>) =>
    request('/agent/configs', {
      method: 'POST',
      body: JSON.stringify({ name, config }),
    }),
  updateAgentConfig: (id: string, config: Record<string, unknown>) =>
    request(`/agent/configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  deleteAgentConfig: (id: string) =>
    request(`/agent/configs/${id}`, { method: 'DELETE' }),

  /** SSE 流式聊天 — 返回 Response 供调用方读取 stream */
  chatStream: (body: ChatRequest) =>
    fetch(`${BASE_URL}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Monitor
  getMonitorEvents: (type?: string) =>
    request(`/monitor/events${type ? `?type=${type}` : ''}`),
  getMonitorStats: () => request('/monitor/stats'),
};

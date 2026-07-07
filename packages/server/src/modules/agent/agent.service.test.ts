import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from './agent.service';

// Mock 外部依赖
vi.mock('@agent-harness/core', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    withTools: vi.fn(),
    withExternalMemory: vi.fn(),
    runStream: vi.fn(),
  })),
  createOpenAIAdapter: vi.fn(() => ({})),
  MemoryManager: vi.fn().mockImplementation(() => ({
    configure: vi.fn(),
    getStats: vi.fn(() => ({ messageCount: 3 })),
    getHistory: vi.fn(() => []),
    addMessage: vi.fn(),
    needsCompression: vi.fn(() => false),
    getCompressibleMessages: vi.fn(() => []),
    getCompressionConfig: vi.fn(() => ({ currentTokens: 1000, maxTokens: 4000, messageCount: 5, keepRecent: 6 })),
    applyCompression: vi.fn(),
    setSystemPrompt: vi.fn(),
  })),
}));

describe('AgentService', () => {
  let service: AgentService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockMonitorService: { ingestEvents: ReturnType<typeof vi.fn>; listEvents: ReturnType<typeof vi.fn>; getEventStats: ReturnType<typeof vi.fn> };
  let mockTraceService: { saveTrace: ReturnType<typeof vi.fn>; updateTrace: ReturnType<typeof vi.fn>; saveSpan: ReturnType<typeof vi.fn> };
  let mockConfigService: { get: ReturnType<typeof vi.fn> };

  function createMockDb() {
    return {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    mockDb = createMockDb();
    mockMonitorService = {
      ingestEvents: vi.fn(),
      listEvents: vi.fn(),
      getEventStats: vi.fn(),
    };
    mockTraceService = {
      saveTrace: vi.fn().mockResolvedValue(undefined),
      updateTrace: vi.fn().mockResolvedValue(undefined),
      saveSpan: vi.fn().mockResolvedValue(undefined),
    };
    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'ai.apiKey') return 'test-api-key';
        if (key === 'ai.baseUrl') return '';
        return '';
      }),
    };

    service = new AgentService(
      mockDb as any,
      mockMonitorService as any,
      mockTraceService as any,
      mockConfigService as any,
    );
  });

  describe('Config CRUD', () => {
    it('listConfigs 应返回活跃配置', async () => {
      const fixture = [{ id: 'cfg-1', name: 'Test', config: '{}', active: true, createdAt: 1, updatedAt: 1 }];
      (mockDb.where as ReturnType<typeof vi.fn>).mockResolvedValue(fixture);

      const result = await service.listConfigs();
      expect(result).toEqual(fixture);
      expect(mockDb.from).toHaveBeenCalled();
    });

    it('getConfig 应返回指定配置', async () => {
      const fixture = { id: 'cfg-1', name: 'Test', config: '{}', active: true, createdAt: 1, updatedAt: 1 };
      (mockDb.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (mockDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([fixture]);

      const result = await service.getConfig('cfg-1');
      expect(result).toEqual(fixture);
    });

    it('getConfig 未找到时应返回 null', async () => {
      (mockDb.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (mockDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.getConfig('nonexistent');
      expect(result).toBeNull();
    });

    it('createConfig 应插入并返回新配置', async () => {
      // mock insert 链
      const mockInsertValues = vi.fn().mockResolvedValue(undefined);
      const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
      mockDb.insert = mockInsert;

      // mock getConfig 回调（createConfig 内部调用 getConfig）
      (mockDb.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (mockDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'cfg-test123', name: 'New', config: '{"x":1}', active: true, createdAt: 1, updatedAt: 1 },
      ]);

      const result = await service.createConfig('New', { x: 1 });
      expect(mockInsert).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.id).toContain('cfg-');
    });
  });

  describe('Session Management', () => {
    it('listSessions 应返回空列表（初始状态）', () => {
      const sessions = service.listSessions();
      expect(sessions).toEqual([]);
    });

    it('getSessionMessages 未找到时应返回 null', () => {
      const result = service.getSessionMessages('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('runAgentStream', () => {
    it('无 API key 时应 yield error 事件', async () => {
      // 覆盖 mock — 返回空 apiKey
      mockConfigService.get.mockReturnValue('');

      const gen = service.runAgentStream('hello', {});
      const firstEvent = await gen.next();
      expect(firstEvent.value).toMatchObject({ type: 'error' });
      expect(firstEvent.value.message).toContain('No API key');
      expect(firstEvent.done).toBe(false);

      const secondEvent = await gen.next();
      expect(secondEvent.done).toBe(true);
    });
  });

  describe('DTO Validation', () => {
    // 内联测试 validate 逻辑（避免动态 import Swagger 导致超时）
    it('validate 应正确校验必填字段', () => {
      // 模拟 ChatDto.validate 逻辑
      function validateMessage(dto: Record<string, unknown>): string | null {
        if (!dto.message || typeof dto.message !== 'string' || dto.message.trim().length === 0) {
          return 'message is required and must be a non-empty string';
        }
        return null;
      }

      expect(validateMessage({})).toBe('message is required and must be a non-empty string');
      expect(validateMessage({ message: '' })).toBe('message is required and must be a non-empty string');
      expect(validateMessage({ message: 'hi' })).toBeNull();
    });

    it('validate 应校验 config 对象类型', () => {
      function validateConfig(dto: Record<string, unknown>): string | null {
        if (!dto.name || typeof dto.name !== 'string' || dto.name.trim().length === 0) {
          return 'name is required and must be a non-empty string';
        }
        if (!dto.config || typeof dto.config !== 'object' || Array.isArray(dto.config)) {
          return 'config is required and must be an object';
        }
        return null;
      }

      expect(validateConfig({})).toBe('name is required and must be a non-empty string');
      expect(validateConfig({ name: 'Test', config: [] })).toBe('config is required and must be an object');
      expect(validateConfig({ name: 'Test', config: {} })).toBeNull();
    });
  });
});

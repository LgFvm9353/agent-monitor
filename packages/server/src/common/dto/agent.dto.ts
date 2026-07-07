import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO 构造器类型 — 具有静态 validate 方法的类
 */
export interface DtoClass {
  new (...args: any[]): any;
  validate(dto: unknown): string | null;
}

/** 创建 Agent 配置 */
export class CreateConfigDto {
  @ApiProperty({ description: '配置名称', example: 'Code Assistant' })
  name!: string;

  @ApiProperty({ description: '配置内容', example: { systemPrompt: 'You are a coding expert...' } })
  config!: Record<string, unknown>;

  static validate(dto: unknown): string | null {
    if (!dto || typeof dto !== 'object') return 'Request body must be an object';
    const body = dto as Record<string, unknown>;
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return 'name is required and must be a non-empty string';
    }
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return 'config is required and must be an object';
    }
    return null;
  }
}

/** 更新 Agent 配置 */
export class UpdateConfigDto {
  @ApiProperty({ description: '配置内容', example: { systemPrompt: 'Updated prompt...' } })
  config!: Record<string, unknown>;

  static validate(dto: unknown): string | null {
    if (!dto || typeof dto !== 'object') return 'Request body must be an object';
    const body = dto as Record<string, unknown>;
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return 'config is required and must be an object';
    }
    return null;
  }
}

/** Agent 对话请求 */
export class ChatDto {
  @ApiProperty({ description: '用户消息', example: '帮我写一段代码' })
  message!: string;

  @ApiProperty({ description: '系统提示词', required: false })
  systemPrompt?: string;

  @ApiProperty({ description: '模型 ID', required: false, example: 'deepseek-v4-pro' })
  modelId?: string;

  @ApiProperty({ description: 'API Key（覆盖环境变量）', required: false })
  apiKey?: string;

  @ApiProperty({ description: 'API Base URL（覆盖环境变量）', required: false })
  baseURL?: string;

  @ApiProperty({ description: 'Provider 类型', required: false, enum: ['openai', 'anthropic'] })
  provider?: 'openai' | 'anthropic';

  @ApiProperty({ description: '采样温度', required: false, example: 0.7 })
  temperature?: number;

  @ApiProperty({ description: '最大输出 token 数', required: false, example: 4096 })
  maxTokens?: number;

  @ApiProperty({ description: '会话 ID（用于多轮对话）', required: false })
  sessionId?: string;

  @ApiProperty({ description: '启用的工具 ID 列表', required: false, example: ['queryMonitorEvents'] })
  enabledTools?: string[];

  static validate(dto: unknown): string | null {
    if (!dto || typeof dto !== 'object') return 'Request body must be an object';
    const body = dto as Record<string, unknown>;
    if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
      return 'message is required and must be a non-empty string';
    }
    if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) {
      return 'temperature must be a number between 0 and 2';
    }
    if (body.maxTokens !== undefined && (typeof body.maxTokens !== 'number' || body.maxTokens < 1)) {
      return 'maxTokens must be a positive number';
    }
    return null;
  }
}

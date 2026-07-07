import { ApiProperty } from '@nestjs/swagger';
import type { DtoClass } from './agent.dto';

/** 创建评估数据集 */
export class CreateDatasetDto {
  @ApiProperty({ description: '数据集名称', example: 'Code Review Questions' })
  name!: string;

  @ApiProperty({ description: '数据集描述', required: false })
  description?: string;

  static validate(dto: unknown): string | null {
    if (!dto || typeof dto !== 'object') return 'Request body must be an object';
    const body = dto as Record<string, unknown>;
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return 'name is required and must be a non-empty string';
    }
    return null;
  }
}

/** 添加评估数据项 */
export class AddItemDto {
  @ApiProperty({ description: '输入内容', example: 'Explain the following code...' })
  input!: string;

  @ApiProperty({ description: '期望输出', required: false })
  expectedOutput?: string;

  @ApiProperty({ description: '标签', required: false, example: ['easy', 'python'] })
  labels?: string[];

  static validate(dto: unknown): string | null {
    if (!dto || typeof dto !== 'object') return 'Request body must be an object';
    const body = dto as Record<string, unknown>;
    if (!body.input || typeof body.input !== 'string' || body.input.trim().length === 0) {
      return 'input is required and must be a non-empty string';
    }
    return null;
  }
}

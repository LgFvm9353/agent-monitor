/**
 * Tool Registry — 工具注册中心
 *
 * 管理 Agent 可用的所有工具，提供：
 * 1. 工具注册/注销
 * 2. Schema 校验（基于 Zod）
 * 3. MCP (Model Context Protocol) 集成接口
 * 4. 沙箱执行
 * 5. 工具调用日志
 *
 * Agent 的工具调用能力是它区别于普通 ChatBot 的核心特征。
 * Tool Registry 是 Agent 的"工具箱"——管理 Agent 能做什么。
 */

import type { ToolDefinition } from '../types';
import { z } from 'zod';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private schemas = new Map<string, z.ZodSchema>();

  /** 注册工具 */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);

    // 自动生成 Zod schema 用于参数校验
    if (tool.parameters) {
      const schema = this.jsonSchemaToZod(tool.parameters);
      this.schemas.set(tool.name, schema);
    }
  }

  /** 批量注册 MCP 工具 */
  registerMCP(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name);
    this.schemas.delete(name);
  }

  /** 获取工具定义 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 列出所有工具 */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** 列出工具名 */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 执行工具
   *
   * @param name - 工具名
   * @param args - 参数
   * @returns 执行结果
   * @throws 工具未找到或参数校验失败
   */
  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found. Available: ${this.listNames().join(', ')}`);
    }

    // Schema 校验
    const schema = this.schemas.get(name);
    if (schema) {
      const result = schema.safeParse(args);
      if (!result.success) {
        throw new Error(`Tool "${name}" parameter validation failed: ${result.error.message}`);
      }
      args = result.data as Record<string, unknown>;
    }

    // 沙箱执行（catch 所有异常）
    try {
      return await Promise.resolve(tool.execute(args));
    } catch (error) {
      throw new Error(
        `Tool "${name}" execution error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * JSON Schema → Zod Schema（简化版转换）
   *
   * 将 OpenAI Function Calling 格式的 JSON Schema 转为 Zod，
   * 用于运行时参数校验。
   */
  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodSchema {
    const type = schema.type as string;
    const properties = schema.properties as Record<string, unknown> | undefined;
    const required = (schema.required as string[]) || [];

    if (type === 'object' && properties) {
      const shape: Record<string, z.ZodSchema> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const propSchema = prop as Record<string, unknown>;
        let fieldSchema: z.ZodSchema;

        switch (propSchema.type) {
          case 'string':
            fieldSchema = z.string();
            if (propSchema.description) {
              fieldSchema = fieldSchema.describe(propSchema.description as string);
            }
            break;
          case 'number':
          case 'integer':
            fieldSchema = z.number();
            break;
          case 'boolean':
            fieldSchema = z.boolean();
            break;
          case 'array':
            fieldSchema = z.array(z.unknown());
            break;
          default:
            fieldSchema = z.unknown();
        }

        // 可选字段
        if (!required.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }

        shape[key] = fieldSchema;
      }
      return z.object(shape);
    }

    return z.unknown();
  }
}

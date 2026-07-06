import { Controller, Get, Post, Put, Delete, Param, Body, Res, Header } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  // ===== Config CRUD =====

  @Get('configs')
  async listConfigs() {
    return this.agentService.listConfigs();
  }

  @Get('configs/:id')
  async getConfig(@Param('id') id: string) {
    return this.agentService.getConfig(id);
  }

  @Post('configs')
  async createConfig(@Body() body: { name: string; config: Record<string, unknown> }) {
    return this.agentService.createConfig(body.name, body.config);
  }

  @Put('configs/:id')
  async updateConfig(
    @Param('id') id: string,
    @Body() body: { config: Record<string, unknown> },
  ) {
    return this.agentService.updateConfig(id, body.config);
  }

  @Delete('configs/:id')
  async deleteConfig(@Param('id') id: string) {
    return this.agentService.deleteConfig(id);
  }

  // ===== Agent Chat (SSE Streaming) =====

  /**
   * Agent 流式对话
   *
   * POST /api/agent/chat
   *
   * 接收 JSON body，返回 SSE 流。
   * 每个事件是一个 JSON 行，格式：`data: {"type":"text-delta","content":"你好"}\n\n`
   *
   * Body:
   * {
   *   "message": "帮我写一段代码",
   *   "systemPrompt": "你是一个编码助手...",
   *   "modelId": "gpt-4o",
   *   "apiKey": "sk-...",
   *   "temperature": 0.7
   * }
   */
  @Post('chat')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  async chat(
    @Body() body: {
      message: string;
      systemPrompt?: string;
      modelId?: string;
      apiKey?: string;
      baseURL?: string;
      provider?: 'openai' | 'anthropic';
      temperature?: number;
      maxTokens?: number;
      enabledTools?: string[];
    },
    @Res() res: { setHeader: (k: string, v: string) => void; flushHeaders: () => void; write: (d: string) => void; end: () => void; status: (c: number) => { json: (d: unknown) => void } },
  ) {
    // 验证必填字段
    if (!body.message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // SSE headers 需要在发送前设置
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = this.agentService.runAgentStream(body.message, {
        systemPrompt: body.systemPrompt,
        modelId: body.modelId,
        apiKey: body.apiKey,
        baseURL: body.baseURL,
        provider: body.provider,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        enabledTools: body.enabledTools,
      });

      for await (const event of stream) {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        res.write(line);

        // 结束流
        if (event.type === 'done' || event.type === 'error') {
          break;
        }
      }
    } catch (error) {
      const errorEvent = {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    } finally {
      res.end();
    }
  }
}

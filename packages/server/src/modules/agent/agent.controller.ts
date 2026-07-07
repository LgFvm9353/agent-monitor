import { Controller, Get, Post, Put, Delete, Param, Body, Res, Header, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiParam } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { CreateConfigDto, UpdateConfigDto, ChatDto } from '../../common/dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  // ===== Config CRUD =====

  @Get('configs')
  @ApiOperation({ summary: '列出所有活跃配置' })
  async listConfigs() {
    return this.agentService.listConfigs();
  }

  @Get('configs/:id')
  @ApiOperation({ summary: '获取单个配置' })
  @ApiParam({ name: 'id', description: '配置 ID' })
  async getConfig(@Param('id') id: string) {
    return this.agentService.getConfig(id);
  }

  @Post('configs')
  @ApiOperation({ summary: '创建 Agent 配置' })
  @ApiBody({ type: CreateConfigDto })
  async createConfig(@Body() body: CreateConfigDto) {
    return this.agentService.createConfig(body.name, body.config);
  }

  @Put('configs/:id')
  @ApiOperation({ summary: '更新 Agent 配置' })
  @ApiParam({ name: 'id', description: '配置 ID' })
  @ApiBody({ type: UpdateConfigDto })
  async updateConfig(
    @Param('id') id: string,
    @Body() body: UpdateConfigDto,
  ) {
    return this.agentService.updateConfig(id, body.config);
  }

  @Delete('configs/:id')
  @ApiOperation({ summary: '删除配置（软删除）' })
  @ApiParam({ name: 'id', description: '配置 ID' })
  async deleteConfig(@Param('id') id: string) {
    return this.agentService.deleteConfig(id);
  }

  // ===== Session Management =====

  /** 列出所有活跃会话 */
  @Get('sessions')
  @ApiOperation({ summary: '列出所有活跃会话' })
  async listSessions() {
    return this.agentService.listSessions();
  }

  /** 获取指定会话的消息历史 */
  @Get('sessions/:id')
  @ApiOperation({ summary: '获取会话消息历史' })
  @ApiParam({ name: 'id', description: '会话 ID' })
  async getSession(@Param('id') id: string) {
    const data = this.agentService.getSessionMessages(id);
    if (!data) throw new NotFoundException('Session not found');
    return data;
  }

  // ===== Agent Chat (SSE Streaming) =====

  /**
   * Agent 流式对话
   *
   * POST /api/agent/chat
   *
   * 接收 JSON body，返回 SSE 流。
   * 每个事件是一个 JSON 行，格式：`data: {"type":"text-delta","content":"你好"}\n\n`
   */
  @Post('chat')
  @ApiOperation({ summary: 'Agent 流式对话（SSE）', description: '发送消息给 Agent，通过 SSE 流式返回响应。支持多轮对话、工具调用、Trace 追踪。' })
  @ApiBody({ type: ChatDto })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  async chat(
    @Body() body: ChatDto,
    @Res() res: { setHeader: (k: string, v: string) => void; flushHeaders: () => void; write: (d: string) => void; end: () => void; status: (c: number) => { json: (d: unknown) => void } },
  ) {
    // ValidationPipe 已校验 message 非空，此处为安全网
    if (!body.message) {
      res.status(400).json({ code: 400, data: null, message: 'message is required', timestamp: Date.now() });
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
        sessionId: body.sessionId,
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

import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

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
}

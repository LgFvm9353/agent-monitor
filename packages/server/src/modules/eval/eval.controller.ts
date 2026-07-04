import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { EvalService } from './eval.service';

@Controller('eval')
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  @Get('datasets')
  async listDatasets() {
    return this.evalService.listDatasets();
  }

  @Post('datasets')
  async createDataset(@Body() body: { name: string; description?: string }) {
    return this.evalService.createDataset(body.name, body.description);
  }

  @Get('datasets/:id')
  async getDataset(@Param('id') id: string) {
    return this.evalService.getDataset(id);
  }

  @Post('datasets/:id/items')
  async addItem(
    @Param('id') id: string,
    @Body() body: { input: string; expectedOutput?: string; labels?: string[] },
  ) {
    return this.evalService.addItem(id, body.input, body.expectedOutput, body.labels);
  }

  @Get('runs')
  async listRuns(@Query('datasetId') datasetId?: string) {
    return this.evalService.listRuns(datasetId);
  }
}

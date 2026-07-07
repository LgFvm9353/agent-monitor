import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { EvalService } from './eval.service';
import { CreateDatasetDto, AddItemDto } from '../../common/dto';

@ApiTags('eval')
@Controller('eval')
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  @Get('datasets')
  @ApiOperation({ summary: '列出所有评估数据集' })
  async listDatasets() {
    return this.evalService.listDatasets();
  }

  @Post('datasets')
  @ApiOperation({ summary: '创建评估数据集' })
  @ApiBody({ type: CreateDatasetDto })
  async createDataset(@Body() body: CreateDatasetDto) {
    return this.evalService.createDataset(body.name, body.description);
  }

  @Get('datasets/:id')
  @ApiOperation({ summary: '获取单个数据集' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  async getDataset(@Param('id') id: string) {
    return this.evalService.getDataset(id);
  }

  @Post('datasets/:id/items')
  @ApiOperation({ summary: '添加评估数据项' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiBody({ type: AddItemDto })
  async addItem(
    @Param('id') id: string,
    @Body() body: AddItemDto,
  ) {
    return this.evalService.addItem(id, body.input, body.expectedOutput, body.labels);
  }

  @Get('runs')
  @ApiOperation({ summary: '列出评估运行记录' })
  @ApiQuery({ name: 'datasetId', required: false, description: '按数据集 ID 过滤' })
  async listRuns(@Query('datasetId') datasetId?: string) {
    return this.evalService.listRuns(datasetId);
  }
}

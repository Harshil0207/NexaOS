import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { toolKey, updateToolSettingSchema } from '@nexa/shared';
import { Org, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { ToolsService } from './tools.service';

@ApiTags('tools')
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @RequirePermission('tools:read')
  list(@Org() ctx: OrgContext) {
    return this.tools.list(ctx);
  }

  @Patch(':key')
  @RequirePermission('tools:manage')
  async update(@Org() ctx: OrgContext, @Param('key') key: string, @Body() body: unknown) {
    await this.tools.setEnabled(
      ctx,
      parse(toolKey, key),
      parse(updateToolSettingSchema, body).enabled,
    );
    return { ok: true };
  }
}

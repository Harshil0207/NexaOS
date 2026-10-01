import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createAgentSchema,
  listAgentsQuery,
  publishAgentSchema,
  updateAgentSchema,
} from '@nexa/shared';
import { Org, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { AgentsService } from './agents.service';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequirePermission('agents:read')
  list(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.agents.list(ctx, parse(listAgentsQuery, q));
  }

  @Post()
  @RequirePermission('agents:write')
  create(@Org() ctx: OrgContext, @Body() body: unknown) {
    return this.agents.create(ctx, parse(createAgentSchema, body));
  }

  @Get(':id')
  @RequirePermission('agents:read')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.get(ctx, id);
  }

  @Get(':id/versions/:versionId')
  @RequirePermission('agents:read')
  version(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.agents.getVersion(ctx, id, versionId);
  }

  @Patch(':id')
  @RequirePermission('agents:write')
  update(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.update(ctx, id, parse(updateAgentSchema, body));
  }

  @Post(':id/publish')
  @RequirePermission('agents:publish')
  publish(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(publishAgentSchema, body);
    return this.agents.publish(ctx, id, input.revision, input.changelog);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('agents:write')
  async archive(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.agents.setArchived(ctx, id, true);
    return { ok: true };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('agents:write')
  async restore(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.agents.setArchived(ctx, id, false);
    return { ok: true };
  }
}

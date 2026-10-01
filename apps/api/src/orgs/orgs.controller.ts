import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addMemberSchema,
  changeRoleSchema,
  createOrganizationSchema,
  switchOrganizationSchema,
} from '@nexa/shared';
import { Auth, Org, RateLimit, RequirePermission } from '../common/decorators';
import { Errors } from '../common/errors';
import type { AuthContext, OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { OrgsService } from './orgs.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  @RateLimit({ bucket: 'org-create', limit: 10, windowSeconds: 3600, by: 'user' })
  create(@Auth() ctx: AuthContext, @Body() body: unknown) {
    return this.orgs.create(ctx, parse(createOrganizationSchema, body).name);
  }

  @Post('switch')
  @HttpCode(200)
  async switch(@Auth() ctx: AuthContext, @Body() body: unknown) {
    await this.orgs.switch(ctx, parse(switchOrganizationSchema, body).organizationId);
    return { ok: true };
  }

  @Get('current')
  @RequirePermission('org:read')
  current(@Org() ctx: OrgContext) {
    return this.orgs.current(ctx);
  }

  @Patch('current')
  @RequirePermission('org:manage')
  async rename(@Org() ctx: OrgContext, @Body() body: unknown) {
    await this.orgs.rename(ctx, parse(createOrganizationSchema, body).name);
    return { ok: true };
  }

  @Get('current/members')
  @RequirePermission('members:read')
  members(@Org() ctx: OrgContext) {
    return this.orgs.listMembers(ctx);
  }

  @Post('current/members')
  @RequirePermission('members:manage')
  addMember(@Org() ctx: OrgContext, @Body() body: unknown) {
    return this.orgs.addMember(ctx, parse(addMemberSchema, body));
  }

  @Patch('current/members/:id')
  @RequirePermission('members:manage')
  async changeRole(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    await this.orgs.changeRole(ctx, id, parse(changeRoleSchema, body).role);
    return { ok: true };
  }

  @Delete('current/members/:id')
  @RequirePermission('members:read')
  async remove(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    // Leaving is allowed for anyone; removing others needs members:manage.
    const isSelf = await this.orgs.isOwnMembership(ctx, id);
    if (!isSelf && !ctx.permissions.has('members:manage')) {
      throw Errors.forbidden();
    }
    await this.orgs.removeMember(ctx, id);
    return { ok: true };
  }
}

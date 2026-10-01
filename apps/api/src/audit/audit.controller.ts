import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { paginationQuery } from '@nexa/shared';
import { z } from 'zod';
import { Org, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { AuditService } from './audit.service';

const auditQuery = paginationQuery.extend({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(60).optional(),
  actorId: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  list(@Org() ctx: OrgContext, @Query() query: unknown) {
    return this.audit.list(ctx, parse(auditQuery, query));
  }
}

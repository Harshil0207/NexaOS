import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Org, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { DashboardService } from './dashboard.service';

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @RequirePermission('executions:read')
  summary(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.dashboard.summary(ctx, parse(daysQuery, q).days);
  }

  @Get('usage')
  @RequirePermission('usage:read')
  usage(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.dashboard.usageSeries(ctx, parse(daysQuery, q).days);
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { runAgentSchema, TERMINAL_STATUSES, ExecutionStatus } from '@nexa/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Org, RateLimit, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { RealtimeBus, RealtimeMessage } from '../realtime/realtime.bus';
import { ExecutionsService, listExecutionsQuery } from './executions.service';
import { openSse } from './sse';

const seqParam = z.coerce.number().int().min(0).max(1_000_000).default(0);

@ApiTags('executions')
@Controller()
export class ExecutionsController {
  constructor(
    private readonly executions: ExecutionsService,
    private readonly bus: RealtimeBus,
  ) {}

  @Post('agents/:id/runs')
  @RequirePermission('agents:execute')
  @RateLimit({ bucket: 'agent-run', limit: 30, windowSeconds: 60, by: 'user' })
  run(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.executions.start(ctx, id, parse(runAgentSchema, body));
  }

  @Get('executions')
  @RequirePermission('executions:read')
  list(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.executions.list(ctx, parse(listExecutionsQuery, q));
  }

  @Get('executions/:id')
  @RequirePermission('executions:read')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.executions.get(ctx, id);
  }

  @Get('executions/:id/events')
  @RequirePermission('executions:read')
  events(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('afterSeq') afterSeq: unknown,
  ) {
    return this.executions.listEvents(ctx, id, parse(seqParam, afterSeq));
  }

  @Post('executions/:id/cancel')
  @HttpCode(200)
  @RequirePermission('executions:read')
  cancel(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.executions.cancel(ctx, id);
  }

  @Post('executions/:id/retry')
  @RequirePermission('executions:retry')
  @RateLimit({ bucket: 'agent-run', limit: 30, windowSeconds: 60, by: 'user' })
  retry(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.executions.retry(ctx, id);
  }

  /**
   * Live timeline for one execution. Replays persisted events after Last-Event-ID, then streams
   * new ones; events are deduplicated by seq so reconnects never duplicate or drop events.
   */
  @Get('executions/:id/stream')
  @RequirePermission('executions:read')
  async stream(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Query('lastEventId') lastEventIdQuery: unknown,
    @Res() res: Response,
  ) {
    const exec = await this.executions.getOwned(ctx, id);
    let lastSeq = parse(seqParam, lastEventIdHeader ?? lastEventIdQuery);
    let replaying = true;
    const buffered: RealtimeMessage[] = [];
    let unsubscribe: (() => void) | null = null;
    const sse = openSse(res, () => unsubscribe?.());

    const deliver = (m: RealtimeMessage) => {
      if (m.executionId !== id) return;
      if (m.kind === 'delta') return sse.send('delta', { step: m.step, text: m.text });
      if (m.seq <= lastSeq) return;
      lastSeq = m.seq;
      sse.send(
        'event',
        { seq: m.seq, type: m.type, payload: m.payload, createdAt: m.createdAt, status: m.status },
        m.seq,
      );
      if (TERMINAL_STATUSES.has(m.status as ExecutionStatus)) sse.send('end', { status: m.status });
    };
    unsubscribe = await this.bus.onOrg(ctx.orgId, (m) =>
      replaying ? buffered.push(m) : deliver(m),
    );

    for (;;) {
      const batch = await this.executions.listEvents(ctx, id, lastSeq);
      for (const e of batch) {
        lastSeq = e.seq;
        sse.send('event', { ...e, createdAt: e.createdAt.toISOString() }, e.seq);
      }
      if (batch.length < 500) break;
    }
    replaying = false;
    buffered.splice(0).forEach(deliver);
    const current = await this.executions.getOwned(ctx, id).catch(() => exec);
    if (TERMINAL_STATUSES.has(current.status)) sse.send('end', { status: current.status });
  }

  /** Organisation-wide status feed for dashboards and lists. */
  @Get('stream')
  @RequirePermission('executions:read')
  async orgStream(@Org() ctx: OrgContext, @Res() res: Response) {
    let unsubscribe: (() => void) | null = null;
    const sse = openSse(res, () => unsubscribe?.());
    unsubscribe = await this.bus.onOrg(ctx.orgId, (m) => {
      if (m.kind !== 'event') return;
      sse.send(
        'execution',
        {
          executionId: m.executionId,
          agentId: m.agentId,
          seq: m.seq,
          type: m.type,
          status: m.status,
          createdAt: m.createdAt,
        },
        `${m.executionId}:${m.seq}`,
      );
    });
    sse.send('ready', { ok: true });
  }
}

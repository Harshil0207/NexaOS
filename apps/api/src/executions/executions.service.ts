import { Inject, Injectable } from '@nestjs/common';
import {
  agentConfigSchema,
  EXECUTION_STATUSES,
  RunAgentInput,
  sourcesFor,
  TERMINAL_STATUSES,
} from '@nexa/shared';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, lt, or, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { decodeCursor, page } from '../common/pagination';
import { isUniqueViolation } from '../common/pg-errors';
import type { OrgContext } from '../common/request-context';
import { DB, Database } from '../db/db.module';
import {
  agents,
  agentVersions,
  executionEvents,
  executions,
  modelUsage,
  toolCalls,
} from '../db/schema';
import { CancellationRegistry } from '../runtime/cancellation.registry';
import { ExecutionEventsService } from '../runtime/execution-events.service';
import { ExecutionQueue } from '../runtime/execution.queue';

export const listExecutionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(EXECUTION_STATUSES).optional(),
  agentId: z.uuid().optional(),
});

const summaryColumns = {
  id: executions.id,
  agentId: executions.agentId,
  agentName: agents.name,
  agentVersionId: executions.agentVersionId,
  status: executions.status,
  triggerSource: executions.triggerSource,
  input: executions.input,
  errorCode: executions.errorCode,
  stepCount: executions.stepCount,
  inputTokens: executions.inputTokens,
  outputTokens: executions.outputTokens,
  costMicros: executions.costMicros,
  createdAt: executions.createdAt,
  startedAt: executions.startedAt,
  finishedAt: executions.finishedAt,
};

@Injectable()
export class ExecutionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly agents: AgentsService,
    private readonly events: ExecutionEventsService,
    private readonly queue: ExecutionQueue,
    private readonly cancellations: CancellationRegistry,
    private readonly audit: AuditService,
  ) {}

  async start(ctx: OrgContext, agentId: string, input: RunAgentInput) {
    const agent = await this.agents.getOwned(ctx, agentId);
    if (agent.status === 'ARCHIVED') throw Errors.conflict('Archived agents cannot run');

    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(ctx.orgId, input.idempotencyKey);
      if (existing) {
        if (existing.agentId !== agentId)
          throw Errors.conflict('Idempotency key already used for a different run');
        return { id: existing.id, status: existing.status, deduplicated: true };
      }
    }

    let config: unknown;
    let versionId: string | null = null;
    if (input.target === 'draft') {
      if (!ctx.permissions.has('agents:write'))
        throw Errors.forbidden('Testing a draft requires edit access');
      config = agentConfigSchema.parse(agent.draftConfig);
    } else {
      if (!agent.publishedVersionId)
        throw Errors.conflict('This agent has no published version yet');
      const v = await this.db.query.agentVersions.findFirst({
        where: and(
          eq(agentVersions.id, agent.publishedVersionId),
          eq(agentVersions.organizationId, ctx.orgId),
        ),
      });
      if (!v) throw Errors.conflict('Published version is missing');
      config = v.config;
      versionId = v.id;
    }

    let row: typeof executions.$inferSelect;
    try {
      row = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(executions)
          .values({
            organizationId: ctx.orgId,
            agentId,
            agentVersionId: versionId,
            config,
            triggerSource: input.target === 'draft' ? 'TEST_CONSOLE' : 'MANUAL',
            triggeredById: ctx.userId,
            input: input.input,
            idempotencyKey: input.idempotencyKey ?? null,
            traceId: ctx.requestId || randomUUID(),
          })
          .returning();
        await this.audit.record(
          { kind: 'user', ctx },
          {
            action: 'execution.started',
            resourceType: 'execution',
            resourceId: created!.id,
            metadata: { agentId, target: input.target, versionId },
          },
          tx,
        );
        return created!;
      });
    } catch (err) {
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.findByIdempotencyKey(ctx.orgId, input.idempotencyKey);
        if (existing) return { id: existing.id, status: existing.status, deduplicated: true };
      }
      throw err;
    }
    await this.events.append(row, 'execution.queued', { trigger: row.triggerSource, versionId });
    // If this enqueue fails the worker's recovery sweep will pick the QUEUED row up.
    await this.queue.enqueue(row.id).catch(() => undefined);
    return { id: row.id, status: row.status, deduplicated: false };
  }

  private findByIdempotencyKey(orgId: string, key: string) {
    return this.db.query.executions.findFirst({
      where: and(eq(executions.organizationId, orgId), eq(executions.idempotencyKey, key)),
      columns: { id: true, status: true, agentId: true },
    });
  }

  async list(ctx: OrgContext, q: z.infer<typeof listExecutionsQuery>) {
    const cursor = decodeCursor(q.cursor);
    const where: SQL[] = [eq(executions.organizationId, ctx.orgId)];
    if (q.status) where.push(eq(executions.status, q.status));
    if (q.agentId) where.push(eq(executions.agentId, q.agentId));
    if (cursor) {
      where.push(
        or(
          lt(executions.createdAt, cursor.createdAt),
          and(eq(executions.createdAt, cursor.createdAt), lt(executions.id, cursor.id)),
        )!,
      );
    }
    const rows = await this.db
      .select(summaryColumns)
      .from(executions)
      .innerJoin(agents, eq(agents.id, executions.agentId))
      .where(and(...where))
      .orderBy(desc(executions.createdAt), desc(executions.id))
      .limit(q.limit + 1);
    return page(
      rows.map((r) => ({ ...r, input: r.input.slice(0, 200) })),
      q.limit,
    );
  }

  async getOwned(ctx: Pick<OrgContext, 'orgId'>, id: string) {
    const exec = await this.db.query.executions.findFirst({
      where: and(eq(executions.id, id), eq(executions.organizationId, ctx.orgId)),
    });
    if (!exec) throw Errors.notFound('Execution');
    return exec;
  }

  async get(ctx: OrgContext, id: string) {
    const exec = await this.getOwned(ctx, id);
    const [agent, calls, usage, version] = await Promise.all([
      this.db.query.agents.findFirst({
        where: eq(agents.id, exec.agentId),
        columns: { id: true, name: true },
      }),
      this.db
        .select()
        .from(toolCalls)
        .where(and(eq(toolCalls.executionId, id), eq(toolCalls.organizationId, ctx.orgId)))
        .orderBy(asc(toolCalls.createdAt)),
      this.db
        .select()
        .from(modelUsage)
        .where(and(eq(modelUsage.executionId, id), eq(modelUsage.organizationId, ctx.orgId)))
        .orderBy(asc(modelUsage.createdAt)),
      exec.agentVersionId
        ? this.db.query.agentVersions.findFirst({
            where: eq(agentVersions.id, exec.agentVersionId),
            columns: { version: true },
          })
        : null,
    ]);
    const { transcript: _transcript, config, ...rest } = exec;
    const cfg = agentConfigSchema.safeParse(config);
    return {
      ...rest,
      agent,
      agentVersion: version?.version ?? null,
      model: cfg.success ? cfg.data.model : null,
      limits: cfg.success ? cfg.data.limits : null,
      toolCalls: calls,
      usage,
      retryable: TERMINAL_STATUSES.has(exec.status) && exec.status !== 'COMPLETED',
    };
  }

  async listEvents(ctx: OrgContext, id: string, afterSeq: number, limit = 500) {
    await this.getOwned(ctx, id);
    return this.db
      .select({
        seq: executionEvents.seq,
        type: executionEvents.type,
        payload: executionEvents.payload,
        createdAt: executionEvents.createdAt,
      })
      .from(executionEvents)
      .where(
        and(
          eq(executionEvents.executionId, id),
          eq(executionEvents.organizationId, ctx.orgId),
          gt(executionEvents.seq, afterSeq),
        ),
      )
      .orderBy(asc(executionEvents.seq))
      .limit(limit);
  }

  async cancel(ctx: OrgContext, id: string) {
    const exec = await this.getOwned(ctx, id);
    const own = exec.triggeredById === ctx.userId;
    if (!own && !ctx.permissions.has('executions:cancel')) throw Errors.forbidden();
    if (TERMINAL_STATUSES.has(exec.status))
      throw Errors.conflict(`Execution is already ${exec.status.toLowerCase()}`);

    // Flag first so a worker that is mid-step observes it; then try to finalise queued runs directly.
    await this.db
      .update(executions)
      .set({ cancelRequested: true })
      .where(
        and(
          eq(executions.id, id),
          eq(executions.organizationId, ctx.orgId),
          inArray(executions.status, sourcesFor('CANCELLED')),
        ),
      );
    await this.audit.record(
      { kind: 'user', ctx },
      { action: 'execution.cancel_requested', resourceType: 'execution', resourceId: id },
    );
    if (exec.status === 'QUEUED') {
      await this.events.transition(
        exec,
        'CANCELLED',
        { finishedAt: new Date(), errorMessage: 'Cancelled by user' },
        'execution.cancelled',
        { by: ctx.userId },
      );
    } else {
      await this.events.append(exec, 'execution.cancel_requested', { by: ctx.userId });
      await this.cancellations.broadcast(id);
    }
    return { ok: true };
  }

  /** Retry creates a new run with the same frozen config. Refused if the failed run already caused side effects. */
  async retry(ctx: OrgContext, id: string) {
    const exec = await this.getOwned(ctx, id);
    if (!TERMINAL_STATUSES.has(exec.status) || exec.status === 'COMPLETED') {
      throw Errors.conflict('Only failed, timed-out or cancelled runs can be retried');
    }
    const [sideEffect] = await this.db
      .select({ id: toolCalls.id })
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.executionId, id),
          eq(toolCalls.kind, 'MUTATION'),
          inArray(toolCalls.status, ['SUCCEEDED', 'RUNNING']),
        ),
      )
      .limit(1);
    if (sideEffect) {
      throw Errors.conflict(
        'This run already changed data (or may have); retrying could duplicate side effects. Start a new run instead.',
      );
    }
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(executions)
        .values({
          organizationId: ctx.orgId,
          agentId: exec.agentId,
          agentVersionId: exec.agentVersionId,
          config: exec.config,
          triggerSource: 'RETRY',
          triggeredById: ctx.userId,
          input: exec.input,
          retryOfId: exec.id,
          traceId: ctx.requestId || randomUUID(),
        })
        .returning();
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'execution.retried',
          resourceType: 'execution',
          resourceId: created!.id,
          metadata: { retryOf: id },
        },
        tx,
      );
      return created!;
    });
    await this.events.append(row, 'execution.queued', { trigger: 'RETRY', retryOf: id });
    await this.queue.enqueue(row.id).catch(() => undefined);
    return { id: row.id, status: row.status };
  }
}

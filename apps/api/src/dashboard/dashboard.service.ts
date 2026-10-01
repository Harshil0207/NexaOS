import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql, sum } from 'drizzle-orm';
import type { OrgContext } from '../common/request-context';
import { DB, Database } from '../db/db.module';
import { agents, auditLogs, executions, modelUsage, toolCalls } from '../db/schema';
import { HealthService } from '../health/health.service';

const DAY = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly health: HealthService,
  ) {}

  async summary(ctx: OrgContext, days: number) {
    const since = new Date(Date.now() - days * DAY);
    const org = eq(executions.organizationId, ctx.orgId);
    const [agentCounts, byStatus, duration, usage, recent, tools, health, audit] =
      await Promise.all([
        this.db
          .select({ status: agents.status, n: count() })
          .from(agents)
          .where(and(eq(agents.organizationId, ctx.orgId), ne(agents.status, 'ARCHIVED')))
          .groupBy(agents.status),
        this.db
          .select({ status: executions.status, n: count() })
          .from(executions)
          .where(and(org, gte(executions.createdAt, since)))
          .groupBy(executions.status),
        this.db
          .select({
            avgMs: sql<
              number | null
            >`avg(extract(epoch from (${executions.finishedAt} - ${executions.startedAt})) * 1000)`,
            p95Ms: sql<
              number | null
            >`percentile_cont(0.95) within group (order by extract(epoch from (${executions.finishedAt} - ${executions.startedAt})) * 1000)`,
          })
          .from(executions)
          .where(
            and(
              org,
              gte(executions.createdAt, since),
              eq(executions.status, 'COMPLETED'),
              isNotNull(executions.startedAt),
            ),
          ),
        this.db
          .select({
            inputTokens: sum(modelUsage.inputTokens),
            outputTokens: sum(modelUsage.outputTokens),
            costMicros: sum(modelUsage.costMicros),
            calls: count(),
            avgLatencyMs: sql<number | null>`avg(${modelUsage.latencyMs})`,
          })
          .from(modelUsage)
          .where(and(eq(modelUsage.organizationId, ctx.orgId), gte(modelUsage.createdAt, since))),
        this.db
          .select({
            id: executions.id,
            agentId: executions.agentId,
            agentName: agents.name,
            status: executions.status,
            triggerSource: executions.triggerSource,
            createdAt: executions.createdAt,
            startedAt: executions.startedAt,
            finishedAt: executions.finishedAt,
            costMicros: executions.costMicros,
          })
          .from(executions)
          .innerJoin(agents, eq(agents.id, executions.agentId))
          .where(org)
          .orderBy(desc(executions.createdAt))
          .limit(8),
        this.db
          .select({ status: toolCalls.status, n: count() })
          .from(toolCalls)
          .where(and(eq(toolCalls.organizationId, ctx.orgId), gte(toolCalls.createdAt, since)))
          .groupBy(toolCalls.status),
        this.health.report(),
        ctx.permissions.has('audit:read')
          ? this.db
              .select({
                id: auditLogs.id,
                action: auditLogs.action,
                actorType: auditLogs.actorType,
                resourceType: auditLogs.resourceType,
                resourceId: auditLogs.resourceId,
                createdAt: auditLogs.createdAt,
              })
              .from(auditLogs)
              .where(eq(auditLogs.organizationId, ctx.orgId))
              .orderBy(desc(auditLogs.createdAt))
              .limit(8)
          : Promise.resolve(null),
      ]);

    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<
      string,
      number
    >;
    const finished =
      (statusCounts.COMPLETED ?? 0) + (statusCounts.FAILED ?? 0) + (statusCounts.TIMED_OUT ?? 0);
    const u = usage[0];
    return {
      windowDays: days,
      agents: {
        published: Number(agentCounts.find((a) => a.status === 'PUBLISHED')?.n ?? 0),
        draft: Number(agentCounts.find((a) => a.status === 'DRAFT')?.n ?? 0),
      },
      executions: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
        inFlight:
          (statusCounts.QUEUED ?? 0) +
          (statusCounts.RUNNING ?? 0) +
          (statusCounts.WAITING_FOR_TOOL ?? 0) +
          (statusCounts.WAITING_FOR_APPROVAL ?? 0),
        successRate: finished ? (statusCounts.COMPLETED ?? 0) / finished : null,
        avgDurationMs: duration[0]?.avgMs != null ? Math.round(Number(duration[0].avgMs)) : null,
        p95DurationMs: duration[0]?.p95Ms != null ? Math.round(Number(duration[0].p95Ms)) : null,
      },
      usage: {
        inputTokens: Number(u?.inputTokens ?? 0),
        outputTokens: Number(u?.outputTokens ?? 0),
        costMicros: Number(u?.costMicros ?? 0),
        modelCalls: Number(u?.calls ?? 0),
        avgLatencyMs: u?.avgLatencyMs != null ? Math.round(Number(u.avgLatencyMs)) : null,
      },
      toolCalls: Object.fromEntries(tools.map((t) => [t.status, Number(t.n)])),
      // Approvals arrive with the workflow phase; reported explicitly rather than faked.
      pendingApprovals: statusCounts.WAITING_FOR_APPROVAL ?? 0,
      recentExecutions: recent,
      recentAudit: audit,
      health,
    };
  }

  /** Daily usage series for charts. */
  async usageSeries(ctx: OrgContext, days: number) {
    const since = new Date(Date.now() - days * DAY);
    const day = sql<string>`to_char(date_trunc('day', ${modelUsage.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        day,
        inputTokens: sum(modelUsage.inputTokens),
        outputTokens: sum(modelUsage.outputTokens),
        costMicros: sum(modelUsage.costMicros),
        calls: count(),
      })
      .from(modelUsage)
      .where(and(eq(modelUsage.organizationId, ctx.orgId), gte(modelUsage.createdAt, since)))
      .groupBy(day)
      .orderBy(day);
    const execDay = sql<string>`to_char(date_trunc('day', ${executions.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const execRows = await this.db
      .select({ day: execDay, status: executions.status, n: count() })
      .from(executions)
      .where(
        and(
          eq(executions.organizationId, ctx.orgId),
          gte(executions.createdAt, since),
          inArray(executions.status, ['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED']),
        ),
      )
      .groupBy(execDay, executions.status);
    const byModel = await this.db
      .select({
        model: modelUsage.model,
        costMicros: sum(modelUsage.costMicros),
        inputTokens: sum(modelUsage.inputTokens),
        outputTokens: sum(modelUsage.outputTokens),
        calls: count(),
      })
      .from(modelUsage)
      .where(and(eq(modelUsage.organizationId, ctx.orgId), gte(modelUsage.createdAt, since)))
      .groupBy(modelUsage.model);

    const series: {
      day: string;
      inputTokens: number;
      outputTokens: number;
      costMicros: number;
      calls: number;
      completed: number;
      failed: number;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      const r = rows.find((x) => x.day === d);
      const ex = execRows.filter((x) => x.day === d);
      series.push({
        day: d,
        inputTokens: Number(r?.inputTokens ?? 0),
        outputTokens: Number(r?.outputTokens ?? 0),
        costMicros: Number(r?.costMicros ?? 0),
        calls: Number(r?.calls ?? 0),
        completed: Number(ex.find((x) => x.status === 'COMPLETED')?.n ?? 0),
        failed: ex.filter((x) => x.status !== 'COMPLETED').reduce((a, x) => a + Number(x.n), 0),
      });
    }
    return {
      series,
      byModel: byModel.map((m) => ({
        model: m.model,
        costMicros: Number(m.costMicros ?? 0),
        inputTokens: Number(m.inputTokens ?? 0),
        outputTokens: Number(m.outputTokens ?? 0),
        calls: Number(m.calls),
      })),
    };
  }
}

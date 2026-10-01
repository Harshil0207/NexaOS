'use client';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  Database,
  Gauge,
  ShieldQuestion,
  Timer,
  Wrench,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StackedBarChart } from '@/components/charts/bar-chart';
import { ExecutionsTable } from '@/components/executions/executions-table';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Stat } from '@/components/ui/stat';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Badge } from '@/components/ui/status';
import { useCan, useMe } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { fmtCompact, fmtCost, fmtDuration, fmtNumber, fmtPercent, fmtRelative } from '@/lib/format';
import type { ExecutionSummary } from '@/lib/types';

interface Dashboard {
  windowDays: number;
  agents: { published: number; draft: number };
  executions: {
    total: number;
    byStatus: Record<string, number>;
    inFlight: number;
    successRate: number | null;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    modelCalls: number;
    avgLatencyMs: number | null;
  };
  toolCalls: Record<string, number>;
  pendingApprovals: number;
  recentExecutions: ExecutionSummary[];
  recentAudit:
    | {
        id: string;
        action: string;
        actorType: string;
        resourceType: string;
        resourceId: string | null;
        createdAt: string;
      }[]
    | null;
  health: {
    status: 'ok' | 'degraded' | 'down';
    checks: {
      database: { ok: boolean; latencyMs?: number };
      redis: { ok: boolean; latencyMs?: number };
      queue: { ok: boolean; waiting?: number; active?: number; failed?: number };
      llm: { configured: boolean };
    };
  };
}
interface Usage {
  series: { day: string; completed: number; failed: number; costMicros: number; calls: number }[];
}

const RANGES = [1, 7, 30] as const;

export default function DashboardPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const can = useCan();
  const me = useMe();
  const q = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api<Dashboard>(`/dashboard?days=${days}`),
    refetchInterval: 60_000,
  });
  const usage = useQuery({
    queryKey: ['usage', Math.max(days, 7)],
    queryFn: () => api<Usage>(`/usage?days=${Math.max(days, 7)}`),
    enabled: can('usage:read'),
  });
  const d = q.data;
  const denied = (d?.toolCalls.DENIED ?? 0) + (d?.toolCalls.INVALID ?? 0);

  return (
    <>
      <PageHeader
        eyebrow={me.data?.activeOrganization?.name}
        title="Dashboard"
        description="Live view of your AI workforce: what ran, what it cost and what needs attention."
        actions={
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5"
          >
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={`h-7 rounded-md px-2.5 text-xs font-medium ${days === r ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'}`}
              >
                {r === 1 ? '24h' : `${r}d`}
              </button>
            ))}
          </div>
        }
      />

      {q.isError ? (
        <Panel>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              loading={!d}
              label="Active agents"
              icon={<Bot />}
              value={d?.agents.published ?? 0}
              sub={d && `${d.agents.draft} in draft`}
            />
            <Stat
              loading={!d}
              label="Runs"
              icon={<Activity />}
              value={fmtNumber(d?.executions.total ?? 0)}
              sub={
                d &&
                (d.executions.inFlight ? `${d.executions.inFlight} in flight` : 'None in flight')
              }
            />
            <Stat
              loading={!d}
              label="Success rate"
              icon={<CheckCircle2 />}
              value={fmtPercent(d?.executions.successRate ?? null)}
              sub={
                d &&
                `${d.executions.byStatus.FAILED ?? 0} failed · ${d.executions.byStatus.TIMED_OUT ?? 0} timed out`
              }
            />
            <Stat
              loading={!d}
              label="AI spend"
              icon={<Coins />}
              value={fmtCost(d?.usage.costMicros ?? 0)}
              sub={
                d &&
                `${fmtCompact(d.usage.inputTokens + d.usage.outputTokens)} tokens · ${d.usage.modelCalls} calls`
              }
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              loading={!d}
              label="Avg run duration"
              icon={<Timer />}
              value={fmtDuration(d?.executions.avgDurationMs)}
              sub={
                d?.executions.p95DurationMs != null
                  ? `p95 ${fmtDuration(d.executions.p95DurationMs)}`
                  : 'No completed runs yet'
              }
            />
            <Stat
              loading={!d}
              label="Model latency"
              icon={<Gauge />}
              value={fmtDuration(d?.usage.avgLatencyMs)}
              sub="Average per model call"
            />
            <Stat
              loading={!d}
              label="Blocked tool calls"
              icon={<Wrench />}
              value={denied}
              sub={
                d && `${d.toolCalls.SUCCEEDED ?? 0} succeeded · ${d.toolCalls.FAILED ?? 0} failed`
              }
            />
            <Stat
              loading={!d}
              label="Pending approvals"
              icon={<ShieldQuestion />}
              value={d?.pendingApprovals ?? 0}
              sub="Approval policies arrive with workflows"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel>
              <PanelHeader
                title="Runs per day"
                description={`Last ${Math.max(days, 7)} days, by outcome`}
              />
              <div className="px-5 py-4">
                {!can('usage:read') ? (
                  <p className="py-8 text-center text-sm text-muted">
                    Daily trends are visible to managers and above.
                  </p>
                ) : usage.isError ? (
                  <ErrorState error={usage.error} onRetry={() => usage.refetch()} />
                ) : !usage.data ? (
                  <div className="h-44 animate-pulse rounded-md bg-surface-2" />
                ) : usage.data.series.every((s) => s.completed + s.failed === 0) ? (
                  <EmptyState
                    title="No finished runs in this period"
                    description="Runs appear here as soon as they complete."
                  />
                ) : (
                  <StackedBarChart
                    title="Runs per day by outcome"
                    data={usage.data.series.map((s) => ({
                      ...s,
                      label: new Date(`${s.day}T00:00:00Z`).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      }),
                    }))}
                    series={[
                      { key: 'completed', label: 'Completed', color: 'var(--success)' },
                      {
                        key: 'failed',
                        label: 'Failed / timed out / cancelled',
                        color: 'var(--danger)',
                        textured: true,
                      },
                    ]}
                    value={(r, k) => r[k as 'completed' | 'failed']}
                    format={(n) => fmtNumber(Math.round(n))}
                  />
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="System health"
                description="Checked on every refresh"
                actions={d && <HealthBadge status={d.health.status} />}
              />
              <ul className="divide-y text-sm">
                {d ? (
                  <>
                    <HealthRow
                      icon={<Database />}
                      label="Database"
                      ok={d.health.checks.database.ok}
                      detail={
                        d.health.checks.database.latencyMs != null
                          ? `${d.health.checks.database.latencyMs} ms`
                          : 'unreachable'
                      }
                    />
                    <HealthRow
                      icon={<Activity />}
                      label="Redis / realtime"
                      ok={d.health.checks.redis.ok}
                      detail={
                        d.health.checks.redis.latencyMs != null
                          ? `${d.health.checks.redis.latencyMs} ms`
                          : 'unreachable'
                      }
                    />
                    <HealthRow
                      icon={<Timer />}
                      label="Execution queue"
                      ok={d.health.checks.queue.ok}
                      detail={
                        d.health.checks.queue.ok
                          ? `${d.health.checks.queue.waiting} waiting · ${d.health.checks.queue.active} active`
                          : 'unavailable'
                      }
                    />
                    <HealthRow
                      icon={<Bot />}
                      label="Model provider"
                      ok={d.health.checks.llm.configured}
                      detail={
                        d.health.checks.llm.configured
                          ? 'configured'
                          : 'no API key configured — runs will fail'
                      }
                    />
                  </>
                ) : (
                  <SkeletonRows rows={4} />
                )}
              </ul>
            </Panel>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel>
              <PanelHeader
                title="Recent runs"
                actions={
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/executions">
                      View all <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                }
              />
              {!d ? (
                <SkeletonRows rows={5} />
              ) : d.recentExecutions.length === 0 ? (
                <EmptyState
                  icon={<Activity />}
                  title="No runs yet"
                  description="Create an agent, give it tools and run it from the test console. Every run shows up here in real time."
                  action={
                    can('agents:write') ? (
                      <Button asChild variant="primary" size="sm">
                        <Link href="/agents?new=1">Create an agent</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ExecutionsTable rows={d.recentExecutions} compact />
              )}
            </Panel>

            <Panel>
              <PanelHeader
                title="Recent activity"
                actions={
                  d?.recentAudit && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/audit">
                        Audit log <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  )
                }
              />
              {!d ? (
                <SkeletonRows rows={5} />
              ) : !d.recentAudit ? (
                <p className="px-5 py-8 text-center text-sm text-muted">
                  The audit trail is visible to admins and owners.
                </p>
              ) : d.recentAudit.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y">
                  {d.recentAudit.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                      <span className="font-mono text-xs text-fg">{a.action}</span>
                      <Badge
                        tone={
                          a.actorType === 'AGENT'
                            ? 'accent'
                            : a.actorType === 'SYSTEM'
                              ? 'neutral'
                              : 'info'
                        }
                        className="h-5 text-[11px]"
                      >
                        {a.actorType.toLowerCase()}
                      </Badge>
                      <time
                        className="ml-auto whitespace-nowrap text-xs text-muted"
                        dateTime={a.createdAt}
                      >
                        {fmtRelative(a.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function HealthBadge({ status }: { status: 'ok' | 'degraded' | 'down' }) {
  if (status === 'ok')
    return (
      <Badge tone="success">
        <CheckCircle2 aria-hidden />
        Operational
      </Badge>
    );
  if (status === 'degraded')
    return (
      <Badge tone="warning">
        <AlertTriangle aria-hidden />
        Degraded
      </Badge>
    );
  return (
    <Badge tone="danger">
      <XCircle aria-hidden />
      Down
    </Badge>
  );
}

function HealthRow({
  icon,
  label,
  ok,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className="text-faint [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto flex items-center gap-2 text-right text-xs text-muted">
        {detail}
        {ok ? (
          <CheckCircle2 className="size-4 text-success" aria-label="Healthy" />
        ) : (
          <AlertTriangle className="size-4 text-warning" aria-label="Needs attention" />
        )}
      </span>
    </li>
  );
}

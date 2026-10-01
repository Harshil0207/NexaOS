'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, RotateCcw, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Timeline } from '@/components/executions/timeline';
import { Button } from '@/components/ui/button';
import { CopyId } from '@/components/ui/copy';
import { ConfirmDialog } from '@/components/ui/dialog';
import { JsonView } from '@/components/ui/json-view';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Badge, ExecutionStatusPill, TERMINAL } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useExecutionStream } from '@/hooks/use-execution-stream';
import { useCan, useMe } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { durationBetween, fmtCost, fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format';
import type { ExecutionDetail, ToolCallRow } from '@/lib/types';

export function ExecutionDetailView({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api<ExecutionDetail>(`/executions/${id}`),
  });
  const stream = useExecutionStream(q.data ? id : null);
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirmRetry, setConfirmRetry] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api(`/executions/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => toast.success('Cancellation requested'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: () => api<{ id: string }>(`/executions/${id}/retry`, { method: 'POST' }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['executions'] });
      router.push(`/executions/${r.id}`);
    },
    onError: (e) => {
      setConfirmRetry(false);
      toast.error(errorMessage(e));
    },
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  if (!e) {
    return (
      <div aria-busy>
        <Skeleton className="mb-6 h-8 w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  const status = stream.status ?? e.status;
  const running = !TERMINAL.has(status);
  const canCancel = running && (can('executions:cancel') || e.triggeredById === me.data?.user.id);
  const mutations = e.toolCalls.filter((t) => t.kind === 'MUTATION' && t.status === 'SUCCEEDED');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/executions"
            className="mb-1.5 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
          >
            <ChevronLeft className="size-3.5" aria-hidden /> Executions
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">
              {e.agent ? (
                <Link href={`/agents/${e.agent.id}`} className="hover:underline">
                  {e.agent.name}
                </Link>
              ) : (
                'Deleted agent'
              )}
            </h1>
            <ExecutionStatusPill status={status} />
            <span className="font-mono text-xs text-muted">
              {e.agentVersion ? `v${e.agentVersion}` : 'draft'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <CopyId value={e.id} />
            <span>{fmtDateTime(e.createdAt)}</span>
            {e.retryOfId && (
              <Link href={`/executions/${e.retryOfId}`} className="hover:text-fg">
                Retry of <span className="font-mono">{e.retryOfId.slice(0, 8)}</span>
              </Link>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {canCancel && (
            <Button
              variant="outline"
              onClick={() => cancel.mutate()}
              loading={cancel.isPending}
              disabled={e.cancelRequested}
            >
              <Square aria-hidden /> {e.cancelRequested ? 'Cancelling…' : 'Cancel run'}
            </Button>
          )}
          {e.retryable && can('executions:retry') && (
            <Button onClick={() => setConfirmRetry(true)}>
              <RotateCcw aria-hidden /> Retry
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Duration', fmtDuration(durationBetween(e.startedAt, e.finishedAt))],
          ['Steps', e.limits ? `${e.stepCount} / ${e.limits.maxSteps}` : String(e.stepCount)],
          ['Input tokens', fmtNumber(e.inputTokens)],
          ['Output tokens', fmtNumber(e.outputTokens)],
          ['Est. cost', fmtCost(e.costMicros)],
          ['Model', e.model?.model ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-1 truncate font-mono text-sm tabular" title={v}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {(status === 'FAILED' || status === 'TIMED_OUT') && e.errorCode && (
        <div
          role="alert"
          className="rounded-[var(--radius-panel)] border border-danger/30 bg-danger/5 px-5 py-4"
        >
          <div className="font-mono text-xs text-danger">{e.errorCode}</div>
          <p className="mt-1 text-sm">{e.errorMessage}</p>
          <p className="mt-2 text-xs text-muted">
            {e.retryable
              ? mutations.length
                ? 'This run already changed data, so retrying is blocked to avoid duplicate side effects.'
                : 'No data was changed by this run; it is safe to retry.'
              : null}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader
            title="Timeline"
            description="Every state change, model call and tool call, in order."
            actions={
              stream.connection === 'reconnecting' ? (
                <Badge tone="warning">Reconnecting…</Badge>
              ) : running ? (
                <Badge tone="accent">Live</Badge>
              ) : null
            }
          />
          <div className="px-5 py-5">
            <Timeline
              events={stream.events}
              live={stream.live}
              running={running}
              startedAt={e.startedAt ?? e.createdAt}
            />
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Input" />
            <p className="whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed">{e.input}</p>
          </Panel>
          <Panel>
            <PanelHeader title="Output" />
            {e.output ? (
              <p className="whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed">
                {e.output}
              </p>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">
                {running ? 'Not finished yet.' : 'No output was produced.'}
              </p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Trace" />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="text-muted">Trace ID</dt>
              <dd>
                <CopyId value={e.traceId} display={e.traceId.slice(0, 18)} />
              </dd>
              <dt className="text-muted">Trigger</dt>
              <dd>{e.triggerSource.replace('_', ' ').toLowerCase()}</dd>
              <dt className="text-muted">Provider</dt>
              <dd>{e.model?.provider ?? '—'}</dd>
              <dt className="text-muted">Started</dt>
              <dd>{e.startedAt ? fmtDateTime(e.startedAt) : '—'}</dd>
              <dt className="text-muted">Finished</dt>
              <dd>{e.finishedAt ? fmtDateTime(e.finishedAt) : '—'}</dd>
            </dl>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Tool calls"
          description="Arguments and results are stored with sensitive fields redacted."
        />
        {e.toolCalls.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted">No tools were called.</p>
        ) : (
          <ToolCallsTable calls={e.toolCalls} />
        )}
      </Panel>

      {e.usage.length > 0 && (
        <Panel>
          <PanelHeader
            title="Model usage"
            description="One row per model call. Cost is estimated from the configured price list."
          />
          <Table>
            <THead>
              <tr>
                <TH>Model</TH>
                <TH className="text-right">Input</TH>
                <TH className="text-right">Output</TH>
                <TH className="text-right">Latency</TH>
                <TH className="text-right">Cost</TH>
              </tr>
            </THead>
            <TBody>
              {e.usage.map((u) => (
                <TR key={u.id}>
                  <TD className="font-mono text-xs">{u.model}</TD>
                  <TD className="text-right font-mono text-xs tabular">
                    {fmtNumber(u.inputTokens)}
                  </TD>
                  <TD className="text-right font-mono text-xs tabular">
                    {fmtNumber(u.outputTokens)}
                  </TD>
                  <TD className="text-right font-mono text-xs tabular">
                    {fmtDuration(u.latencyMs)}
                  </TD>
                  <TD className="text-right font-mono text-xs tabular">{fmtCost(u.costMicros)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Panel>
      )}

      <ConfirmDialog
        open={confirmRetry}
        onOpenChange={setConfirmRetry}
        title="Retry this run?"
        description="A new run starts with the same input and the same frozen configuration. The original run is kept for the record."
        confirmLabel="Retry run"
        loading={retry.isPending}
        onConfirm={() => retry.mutate()}
      />
    </div>
  );
}

function ToolCallsTable({ calls }: { calls: ToolCallRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const tone = {
    SUCCEEDED: 'success',
    FAILED: 'danger',
    DENIED: 'warning',
    INVALID: 'warning',
    RUNNING: 'accent',
  } as const;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Tool</TH>
          <TH>Result</TH>
          <TH className="hidden sm:table-cell">Kind</TH>
          <TH className="text-right">Attempts</TH>
          <TH className="text-right">Duration</TH>
          <TH className="sr-only">Details</TH>
        </tr>
      </THead>
      <TBody>
        {calls.map((c) => (
          <Fragment key={c.id}>
            <TR>
              <TD className="font-mono text-[13px]">{c.toolKey}</TD>
              <TD>
                <Badge tone={tone[c.status]}>{c.status.toLowerCase()}</Badge>
                {c.errorCode && (
                  <span className="ml-2 font-mono text-xs text-muted">{c.errorCode}</span>
                )}
              </TD>
              <TD className="hidden text-xs text-muted sm:table-cell">
                {c.kind === 'MUTATION' ? 'changes data' : 'read'}
              </TD>
              <TD className="text-right font-mono text-xs tabular">{c.attempts}</TD>
              <TD className="text-right font-mono text-xs tabular">{fmtDuration(c.durationMs)}</TD>
              <TD className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={open === c.id}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                >
                  {open === c.id ? 'Hide' : 'Inspect'}
                </Button>
              </TD>
            </TR>
            {open === c.id && (
              <tr>
                <td colSpan={6} className="bg-surface-2/40 px-5 py-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted">Arguments</div>
                      <JsonView value={c.arguments} />
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted">
                        {c.errorMessage ? 'Error' : 'Result'}
                      </div>
                      <JsonView
                        value={
                          c.errorMessage ? { code: c.errorCode, message: c.errorMessage } : c.result
                        }
                      />
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </TBody>
    </Table>
  );
}

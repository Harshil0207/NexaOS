'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Send, Square, TerminalSquare } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Timeline } from '@/components/executions/timeline';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { ExecutionStatusPill, TERMINAL } from '@/components/ui/status';
import { useExecutionStream } from '@/hooks/use-execution-stream';
import { api, errorMessage } from '@/lib/api';
import { durationBetween, fmtCost, fmtDuration, fmtNumber } from '@/lib/format';
import type { ExecutionDetail } from '@/lib/types';

export function TestConsole({
  agentId,
  dirty,
  canTestDraft,
  hasPublished,
}: {
  agentId: string;
  dirty: boolean;
  canTestDraft: boolean;
  hasPublished: boolean;
}) {
  const [input, setInput] = useState('');
  const [target, setTarget] = useState<'draft' | 'published'>(canTestDraft ? 'draft' : 'published');
  const [runId, setRunId] = useState<string | null>(null);
  const stream = useExecutionStream(runId);
  const detail = useQuery({
    queryKey: ['execution', runId],
    queryFn: () => api<ExecutionDetail>(`/executions/${runId}`),
    enabled: !!runId,
  });
  const formRef = useRef<HTMLFormElement>(null);

  const run = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/agents/${agentId}/runs`, {
        body: { input, target, idempotencyKey: crypto.randomUUID() },
      }),
    onSuccess: (r) => setRunId(r.id),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/executions/${runId}/cancel`, { method: 'POST' }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const status = stream.status ?? detail.data?.status ?? null;
  const running = !!runId && !!status && !TERMINAL.has(status);
  const d = detail.data;

  return (
    <section
      aria-label="Test console"
      className="flex min-h-0 flex-col rounded-[var(--radius-panel)] border bg-surface shadow-panel"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <TerminalSquare className="size-4 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Test console</h2>
        <div
          role="radiogroup"
          aria-label="Version to run"
          className="ml-auto inline-flex rounded-md border border-border-strong bg-surface-2 p-0.5 text-xs"
        >
          {(['draft', 'published'] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={target === t}
              disabled={(t === 'draft' && !canTestDraft) || (t === 'published' && !hasPublished)}
              onClick={() => setTarget(t)}
              className={`h-6 rounded px-2 font-medium disabled:opacity-40 ${target === t ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
            >
              {t === 'draft' ? 'Draft' : 'Published'}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!runId ? (
          <div className="py-10 text-center text-[13px] text-muted">
            <p className="font-medium text-fg">Send a message to run the agent</p>
            <p className="mt-1">
              Each run is a real execution: real model calls, real tool calls, full audit trail.
            </p>
            <button
              className="mt-4 rounded-md border px-2.5 py-1.5 font-mono text-xs text-fg hover:bg-surface-2"
              onClick={() => setInput('Where is order #1234?')}
            >
              Where is order #1234?
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-md border bg-surface-2 px-3 py-2 text-[13px]">
              <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                Input
              </div>
              {d?.input ?? input}
            </div>
            <Timeline
              events={stream.events}
              live={stream.live}
              running={running}
              startedAt={d?.startedAt ?? d?.createdAt}
            />
            {status === 'COMPLETED' && d?.output && (
              <div className="mt-2 rounded-md border border-success/30 bg-success/5 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-success">
                  Response
                </div>
                {d.output}
              </div>
            )}
            {(status === 'FAILED' || status === 'TIMED_OUT') && d && (
              <div
                role="alert"
                className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-[13px]"
              >
                <div className="font-mono text-xs text-danger">{d.errorCode}</div>
                <div className="mt-0.5">{d.errorMessage}</div>
              </div>
            )}
          </>
        )}
      </div>

      {runId && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-surface-2/50 px-4 py-2 text-xs text-muted">
          {status && <ExecutionStatusPill status={status} />}
          <span className="font-mono tabular">
            {fmtDuration(durationBetween(d?.startedAt ?? null, d?.finishedAt ?? null))}
          </span>
          <span className="font-mono tabular">
            {fmtNumber((d?.inputTokens ?? 0) + (d?.outputTokens ?? 0))} tok
          </span>
          <span className="font-mono tabular">{fmtCost(d?.costMicros ?? 0)}</span>
          {stream.connection === 'reconnecting' && (
            <span className="text-warning">Reconnecting…</span>
          )}
          <Link
            href={`/executions/${runId}`}
            className="ml-auto inline-flex items-center gap-1 hover:text-fg"
          >
            Details <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      )}

      <form
        ref={formRef}
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !running) run.mutate();
        }}
      >
        {target === 'draft' && dirty && (
          <p className="mb-2 text-xs text-warning">
            Unsaved changes are not included. Runs use the last saved draft.
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="console-input" className="sr-only">
            Message
          </label>
          <Textarea
            id="console-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder="Ask the agent something…"
            className="max-h-40 min-h-10 resize-none py-2"
            rows={1}
            maxLength={8000}
          />
          {running ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => cancel.mutate()}
              loading={cancel.isPending}
              aria-label="Stop run"
            >
              <Square />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              loading={run.isPending}
              disabled={!input.trim()}
              aria-label="Run agent"
            >
              <Send />
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

'use client';
import {
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  Hourglass,
  Play,
  RotateCcw,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { JsonView } from '@/components/ui/json-view';
import { cn } from '@/lib/cn';
import { fmtCost, fmtDuration } from '@/lib/format';
import { describeEvent, type Tone } from '@/lib/timeline';
import type { TimelineEvent } from '@/lib/types';

const ICONS: Record<string, typeof Bot> = {
  'execution.queued': Clock3,
  'execution.started': Play,
  'execution.resumed': RotateCcw,
  'execution.cancel_requested': Ban,
  'llm.request': Cpu,
  'llm.retry': RotateCcw,
  'llm.response': Bot,
  'llm.error': AlertTriangle,
  'tool.requested': Wrench,
  'tool.started': Wrench,
  'tool.succeeded': CheckCircle2,
  'tool.denied': ShieldAlert,
  'tool.invalid': ShieldAlert,
  'tool.failed': XCircle,
  'execution.completed': CheckCircle2,
  'execution.failed': XCircle,
  'execution.cancelled': Ban,
  'execution.timed_out': Hourglass,
};

const TONE: Record<Tone, string> = {
  accent: 'text-accent border-accent/40 bg-accent-soft',
  success: 'text-success border-success/40 bg-success/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  info: 'text-info border-info/40 bg-info/10',
  neutral: 'text-muted border-border-strong bg-surface-2',
};

/** Events whose payloads are worth expanding (arguments, results, model text). */
const EXPANDABLE = new Set([
  'tool.requested',
  'tool.succeeded',
  'tool.failed',
  'tool.denied',
  'tool.invalid',
  'llm.response',
  'execution.completed',
  'execution.failed',
]);

export function Timeline({
  events,
  live,
  running,
  startedAt,
}: {
  events: TimelineEvent[];
  live?: Record<number, string>;
  running?: boolean;
  startedAt?: string | null;
}) {
  const t0 = startedAt
    ? new Date(startedAt).getTime()
    : events[0]
      ? new Date(events[0].createdAt).getTime()
      : 0;
  const liveSteps = Object.entries(live ?? {});
  return (
    <ol className="relative" aria-live="polite" aria-relevant="additions">
      {events.map((e, i) => (
        <TimelineItem
          key={e.seq}
          event={e}
          offsetMs={new Date(e.createdAt).getTime() - t0}
          last={i === events.length - 1 && !running && liveSteps.length === 0}
        />
      ))}
      {liveSteps.map(([step, text]) => (
        <li key={`live-${step}`} className="relative flex gap-3 pb-4 animate-fade-in">
          <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent-soft text-accent">
            <Bot className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <div className="text-[13px] font-medium">Model is responding · step {step}</div>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border bg-surface-2 p-2.5 text-[13px] leading-relaxed text-fg">
              {text}
              <span
                className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent animate-pulse-dot"
                aria-hidden
              />
            </p>
          </div>
        </li>
      ))}
      {running && liveSteps.length === 0 && (
        <li className="relative flex items-center gap-3 pb-1 text-[13px] text-muted">
          <span className="relative z-10 grid size-7 place-items-center rounded-full border border-dashed border-border-strong">
            <CircleDot className="size-3.5 animate-pulse-dot text-accent" aria-hidden />
          </span>
          Working…
        </li>
      )}
    </ol>
  );
}

function TimelineItem({
  event,
  offsetMs,
  last,
}: {
  event: TimelineEvent;
  offsetMs: number;
  last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const d = describeEvent(event);
  const Icon = ICONS[event.type] ?? CircleDot;
  const p = event.payload as Record<string, unknown>;
  const expandable = EXPANDABLE.has(event.type);
  const metric =
    event.type === 'llm.response'
      ? [
          fmtDuration(Number(p.latencyMs)),
          p.pricingKnown === false ? 'cost n/a' : fmtCost(Number(p.costMicros ?? 0)),
        ].join(' · ')
      : typeof p.durationMs === 'number'
        ? fmtDuration(p.durationMs)
        : null;
  const body =
    event.type === 'tool.requested'
      ? { arguments: p.arguments }
      : event.type === 'tool.succeeded'
        ? { result: p.result }
        : event.type === 'llm.response'
          ? { text: p.text, toolCalls: p.toolCalls }
          : event.type === 'execution.completed'
            ? { output: p.output }
            : p;

  return (
    <li className="relative flex gap-3 pb-4 animate-fade-in">
      {!last && (
        <span aria-hidden className="absolute left-[13.5px] top-7 bottom-0 w-px bg-border-strong" />
      )}
      <span
        className={cn(
          'relative z-10 grid size-7 shrink-0 place-items-center rounded-full border',
          TONE[d.tone],
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expandable ? open : undefined}
          className={cn(
            'flex w-full items-start gap-2 rounded-md py-1 text-left',
            expandable && 'hover:bg-surface-2/60 -mx-1.5 px-1.5',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium text-fg">{d.title}</span>
              {metric && <span className="font-mono text-xs text-muted tabular">{metric}</span>}
            </div>
            {d.detail && <div className="mt-0.5 truncate text-xs text-muted">{d.detail}</div>}
          </div>
          <span
            className="shrink-0 pt-0.5 font-mono text-[11px] text-faint tabular"
            title={new Date(event.createdAt).toLocaleString()}
          >
            +{fmtDuration(Math.max(0, offsetMs))}
          </span>
          {expandable && (
            <ChevronRight
              className={cn(
                'mt-0.5 size-3.5 shrink-0 text-faint transition-transform',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          )}
        </button>
        {open && <JsonView value={body} className="mt-1.5" />}
      </div>
    </li>
  );
}

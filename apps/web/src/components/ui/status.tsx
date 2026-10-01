import type { ExecutionStatus } from '@nexa/shared';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Hourglass,
  Loader2,
  ShieldQuestion,
  Wrench,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent';

const toneClass: Record<Tone, string> = {
  success: 'text-success bg-success/10 ring-success/25',
  danger: 'text-danger bg-danger/10 ring-danger/25',
  warning: 'text-warning bg-warning/10 ring-warning/25',
  info: 'text-info bg-info/10 ring-info/25',
  accent: 'text-accent bg-accent-soft ring-accent/25',
  neutral: 'text-muted bg-surface-2 ring-border-strong',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap [&_svg]:size-3.5',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const EXEC: Record<
  ExecutionStatus,
  { tone: Tone; label: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  QUEUED: { tone: 'neutral', label: 'Queued', Icon: Clock3 },
  RUNNING: { tone: 'accent', label: 'Running', Icon: Loader2, spin: true },
  WAITING_FOR_TOOL: { tone: 'accent', label: 'Calling tool', Icon: Wrench },
  WAITING_FOR_APPROVAL: { tone: 'warning', label: 'Awaiting approval', Icon: ShieldQuestion },
  COMPLETED: { tone: 'success', label: 'Completed', Icon: CheckCircle2 },
  FAILED: { tone: 'danger', label: 'Failed', Icon: XCircle },
  CANCELLED: { tone: 'neutral', label: 'Cancelled', Icon: Ban },
  TIMED_OUT: { tone: 'warning', label: 'Timed out', Icon: Hourglass },
};

/** Execution status: icon + word + colour, never colour alone. */
export function ExecutionStatusPill({
  status,
  className,
}: {
  status: ExecutionStatus;
  className?: string;
}) {
  const s = EXEC[status] ?? { tone: 'neutral' as Tone, label: status, Icon: CircleDashed };
  return (
    <Badge tone={s.tone} className={className}>
      <s.Icon aria-hidden className={cn(s.spin && 'animate-spin')} />
      {s.label}
    </Badge>
  );
}

export function AgentStatusPill({ status }: { status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
  const map = {
    DRAFT: ['neutral', 'Draft'],
    PUBLISHED: ['success', 'Published'],
    ARCHIVED: ['warning', 'Archived'],
  } as const;
  const [tone, label] = map[status];
  return (
    <Badge tone={tone}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          status === 'PUBLISHED' ? 'bg-success' : status === 'ARCHIVED' ? 'bg-warning' : 'bg-faint',
        )}
      />
      {label}
    </Badge>
  );
}

export const TERMINAL: ReadonlySet<ExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

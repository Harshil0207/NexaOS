import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './states';

export function Stat({
  label,
  value,
  sub,
  icon,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-[var(--radius-panel)] border bg-surface p-4 shadow-panel', className)}
    >
      <div className="flex items-center justify-between text-[13px] text-muted">
        {label}
        {icon && <span className="text-faint [&_svg]:size-4">{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-20" />
      ) : (
        <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] tabular">{value}</div>
      )}
      {sub && !loading && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

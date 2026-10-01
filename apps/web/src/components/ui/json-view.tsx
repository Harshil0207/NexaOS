import { cn } from '@/lib/cn';

/** Read-only JSON with preserved formatting. Values arrive already redacted by the server. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-80 overflow-auto rounded-md border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg',
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

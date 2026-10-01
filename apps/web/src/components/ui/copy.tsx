'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

/** Monospace identifier with one-click copy. */
export function CopyId({
  value,
  display,
  className,
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable (insecure context) */
        }
      }}
      className={cn(
        'group inline-flex items-center gap-1 rounded px-1 -mx-1 font-mono text-xs text-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
      aria-label={`Copy ${value}`}
      title={value}
    >
      {display ?? value}
      {copied ? (
        <Check className="size-3 text-success" aria-hidden />
      ) : (
        <Copy
          className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}

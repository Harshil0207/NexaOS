export function Logo({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="inline-flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
          <rect
            x="1"
            y="1"
            width="22"
            height="22"
            rx="6"
            className="fill-surface-3 stroke-border-strong"
            strokeWidth="1"
          />
          <path
            d="M7 16.5V7.5l10 9V7.5"
            fill="none"
            className="stroke-accent"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[15px] font-semibold tracking-[-0.01em]">
          Nexa<span className="text-muted">OS</span>
        </span>
      </span>
    </span>
  );
}

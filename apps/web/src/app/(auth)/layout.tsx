import type { ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-12">{children}</div>
        </div>
        <p className="text-xs text-faint">
          Sessions are protected with httpOnly cookies. Every action is audited.
        </p>
      </main>
      <aside aria-hidden className="relative hidden overflow-hidden border-l bg-surface lg:block">
        <div className="absolute inset-0 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_40%_45%,black_30%,transparent_75%)]" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
            AI Workforce OS
          </p>
          <h2 className="mt-4 max-w-[18ch] text-3xl font-semibold leading-tight tracking-[-0.02em] text-balance">
            Agents that do real work — with every step on the record.
          </h2>
          <ul className="mt-10 grid max-w-md gap-3 font-mono text-[13px]">
            {[
              ['execution.started', 'Support Agent · v3'],
              ['tool.succeeded', 'getOrder · 142 ms'],
              ['tool.denied', 'createSupportTicket · PERMISSION_DENIED'],
              ['execution.completed', '2 steps · 1,284 tokens · $0.0031'],
            ].map(([t, d], i) => (
              <li
                key={t}
                className="flex items-center gap-3 rounded-lg border bg-bg/60 px-3 py-2.5"
              >
                <span className="text-faint tabular">{String(i + 1).padStart(2, '0')}</span>
                <span
                  className={
                    t === 'tool.denied'
                      ? 'text-warning'
                      : t === 'execution.completed'
                        ? 'text-success'
                        : 'text-accent'
                  }
                >
                  {t}
                </span>
                <span className="ml-auto truncate text-muted">{d}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-faint">Illustrative timeline</p>
        </div>
      </aside>
    </div>
  );
}

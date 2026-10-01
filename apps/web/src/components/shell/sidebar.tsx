'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCan } from '@/hooks/use-session';
import { cn } from '@/lib/cn';
import { Logo } from './logo';
import { NAV } from './nav';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
              {group.section}
            </div>
            <ul className="grid gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                        active &&
                          'bg-surface-2 text-fg before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-accent',
                      )}
                    >
                      <item.icon
                        className={cn('size-4', active ? 'text-accent' : 'text-faint')}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-surface/60 lg:flex">
      <div className="flex h-14 items-center border-b px-5">
        <Link href="/dashboard" aria-label="NexaOS home">
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>
      <div className="border-t px-5 py-3 text-[11px] text-faint">AI Workforce OS · v0.1</div>
    </aside>
  );
}

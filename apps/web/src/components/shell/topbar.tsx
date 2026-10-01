'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { StreamState } from '@/hooks/use-org-stream';
import { useMe } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Logo } from './logo';
import { SidebarNav } from './sidebar';
import { useState } from 'react';

const menuContent =
  'z-50 min-w-56 rounded-[var(--radius-panel)] border border-border-strong bg-surface/95 p-1 shadow-panel backdrop-blur-md data-[state=open]:animate-fade-in';
const menuItem =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted';

function OrgSwitcher() {
  const { data } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const active = data?.activeOrganization;
  const switchTo = async (id: string) => {
    try {
      await api('/organizations/switch', { body: { organizationId: id } });
      qc.clear(); // never show one tenant's cached data under another
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          className="flex h-9 min-w-0 max-w-64 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium hover:bg-surface-2"
          aria-label="Switch organisation"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft text-[11px] font-semibold text-accent">
            {active?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate">{active?.name}</span>
          <span className="hidden text-xs font-normal text-faint sm:inline">
            {active?.role.toLowerCase()}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={menuContent}>
          <Menu.Label className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
            Organisations
          </Menu.Label>
          {data?.organizations.map((o) => (
            <Menu.Item
              key={o.id}
              className={menuItem}
              onSelect={() => o.id !== active?.id && switchTo(o.id)}
            >
              <Building2 aria-hidden />
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === active?.id && <Check className="!text-accent" aria-label="Current" />}
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={menuItem} asChild>
            <Link href="/onboarding?new=1">
              <Plus aria-hidden /> New organisation
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function UserMenu() {
  const { data } = useMe();
  const { theme, setTheme } = useTheme();
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  };
  const initials = (data?.user.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          className="grid size-8 place-items-center rounded-full border border-border-strong bg-surface-2 text-xs font-semibold hover:bg-surface-3"
          aria-label="Account menu"
        >
          {initials}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={menuContent}>
          <div className="px-2 py-2">
            <div className="truncate text-[13px] font-medium">{data?.user.name}</div>
            <div className="truncate text-xs text-muted">{data?.user.email}</div>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={menuItem} asChild>
            <Link href="/settings">
              <User aria-hidden /> Profile & settings
            </Link>
          </Menu.Item>
          <Menu.Label className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
            Theme
          </Menu.Label>
          <Menu.RadioGroup value={theme} onValueChange={setTheme}>
            {[
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Monitor],
            ].map(([v, label, Icon]) => (
              <Menu.RadioItem key={v as string} value={v as string} className={menuItem}>
                {(() => {
                  const I = Icon as typeof Sun;
                  return <I aria-hidden />;
                })()}
                <span className="flex-1">{label as string}</span>
                <Menu.ItemIndicator>
                  <Check className="!text-accent" aria-hidden />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={menuItem} onSelect={logout}>
            <LogOut aria-hidden /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function LiveIndicator({ state }: { state: StreamState }) {
  const label =
    state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex"
      role="status"
      aria-live="polite"
      title="Real-time updates"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          state === 'live' ? 'bg-success animate-pulse-dot' : 'bg-warning',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function Topbar({
  stream,
  onOpenPalette,
}: {
  stream: StreamState;
  onOpenPalette: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-bg/80 px-4 backdrop-blur-md sm:px-6">
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
            <MenuIcon />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r bg-surface shadow-panel data-[state=open]:animate-fade-in lg:hidden">
            <DialogPrimitive.Title className="flex h-14 items-center border-b px-5">
              <Logo />
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Main navigation
            </DialogPrimitive.Description>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <OrgSwitcher />
      <div className="ml-auto flex items-center gap-3">
        <LiveIndicator state={stream} />
        <button
          onClick={onOpenPalette}
          className="flex h-8 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-muted hover:text-fg"
          aria-label="Search and commands"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="hidden md:inline">Search</span>
          <kbd className="hidden rounded border bg-surface-2 px-1 font-mono text-[10px] md:inline">
            ⌘K
          </kbd>
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

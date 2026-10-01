'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useOrgStream } from '@/hooks/use-org-stream';
import { useMe } from '@/hooks/use-session';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const hasOrg = !!me.data?.activeOrganization;
  const stream = useOrgStream(hasOrg);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    if (me.data && !me.data.activeOrganization) router.replace('/onboarding');
  }, [me.data, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (me.isError)
    return (
      <ErrorState
        error={me.error}
        onRetry={() => me.refetch()}
        className="min-h-dvh justify-center"
      />
    );
  if (!me.data || !hasOrg) {
    return (
      <div className="flex min-h-dvh" aria-busy="true">
        <div className="hidden w-60 border-r lg:block" />
        <div className="flex-1 p-8">
          <Skeleton className="mb-6 h-7 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar stream={stream} onOpenPalette={() => setPalette(true)} />
        <main
          id="main"
          className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}

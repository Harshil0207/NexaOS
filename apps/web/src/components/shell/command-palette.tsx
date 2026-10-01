'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Bot, CornerDownLeft, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCan } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { AgentSummary } from '@/lib/types';
import { NAV } from './nav';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: typeof Bot;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const agents = useQuery({
    queryKey: ['agents', 'palette'],
    queryFn: () => api<AgentSummary[]>('/agents'),
    enabled: open && can('agents:read'),
  });

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      onOpenChange(false);
      router.push(href);
    };
    const nav = NAV.flatMap((g) =>
      g.items
        .filter((i) => !i.permission || can(i.permission))
        .map((i) => ({
          id: `nav:${i.href}`,
          label: i.label,
          group: 'Go to',
          icon: i.icon,
          run: go(i.href),
        })),
    );
    const actions: Command[] = can('agents:write')
      ? [
          {
            id: 'new-agent',
            label: 'Create agent',
            group: 'Actions',
            icon: Plus,
            run: go('/agents?new=1'),
          },
        ]
      : [];
    const agentCmds = (agents.data ?? []).map((a) => ({
      id: `agent:${a.id}`,
      label: a.name,
      group: 'Agents',
      icon: Bot,
      run: go(`/agents/${a.id}`),
    }));
    return [...actions, ...nav, ...agentCmds];
  }, [agents.data, can, onOpenChange, router]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? commands.filter((c) => c.label.toLowerCase().includes(term)) : commands;
  }, [commands, q]);

  useEffect(() => setIndex(0), [q, open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[index]?.run();
    }
  };

  let lastGroup = '';
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ('');
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface/95 shadow-panel backdrop-blur-md data-[state=open]:animate-fade-in"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search pages, agents and actions
          </DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-faint" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages, agents, actions…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={filtered[index] ? `cmd-${index}` : undefined}
            />
          </div>
          <ul
            id="palette-list"
            ref={listRef}
            role="listbox"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">No results for “{q}”</li>
            )}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={c.id} role="presentation">
                  {header && (
                    <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
                      {header}
                    </div>
                  )}
                  <div
                    id={`cmd-${i}`}
                    role="option"
                    aria-selected={i === index}
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={c.run}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px]',
                      i === index ? 'bg-surface-2 text-fg' : 'text-muted',
                    )}
                  >
                    <c.icon className="size-4 text-faint" aria-hidden />
                    <span className="flex-1 truncate">{c.label}</span>
                    {i === index && <CornerDownLeft className="size-3.5 text-faint" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

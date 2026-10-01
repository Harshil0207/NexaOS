'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChevronLeft, MoreHorizontal, Rocket, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { AgentStatusPill } from '@/components/ui/status';
import { useCan } from '@/hooks/use-session';
import { isDirty, validateDraft, type DraftState } from '@/lib/agent-draft';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { AgentDetail, ModelCatalog, ToolInfo } from '@/lib/types';
import {
  InstructionsSection,
  LimitsSection,
  ModelSection,
  OverviewSection,
  PermissionsSection,
  ToolsSection,
  VersionsSection,
} from './sections';
import { TestConsole } from './test-console';

const SECTIONS = [
  ['overview', 'Overview'],
  ['instructions', 'Instructions'],
  ['model', 'Model'],
  ['tools', 'Tools'],
  ['permissions', 'Permissions'],
  ['limits', 'Limits'],
  ['versions', 'Versions'],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function AgentBuilder({ id }: { id: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const section = (SECTIONS.find(([s]) => s === params.get('section'))?.[0] ??
    'overview') as Section;
  const setSection = (s: Section) =>
    router.replace(`/agents/${id}?section=${s}`, { scroll: false });

  const agent = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api<AgentDetail>(`/agents/${id}`),
  });
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api<ToolInfo[]>('/tools') });
  const catalog = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => api<ModelCatalog>('/llm/models'),
    staleTime: 300_000,
  });

  const saved = useMemo<DraftState | null>(
    () =>
      agent.data
        ? {
            name: agent.data.name,
            description: agent.data.description,
            config: agent.data.draftConfig,
          }
        : null,
    [agent.data],
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [saved]);

  const dirty = !!draft && !!saved && isDirty(draft, saved);
  const errors = draft ? validateDraft(draft) : {};
  const readOnly = !can('agents:write') || agent.data?.status === 'ARCHIVED';

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api<AgentDetail>(`/agents/${id}`, {
        method: 'PATCH',
        body: { ...draft!, revision: agent.data!.draftRevision },
      }),
    onSuccess: () => {
      toast.success('Draft saved');
      void qc.invalidateQueries({ queryKey: ['agent', id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        toast.error('Someone else changed this agent', {
          description: 'Reload to get their changes. Your edits are still on screen.',
          action: { label: 'Reload', onClick: () => void agent.refetch() },
          duration: 10_000,
        });
      } else toast.error(errorMessage(e));
    },
  });
  const [publishOpen, setPublishOpen] = useState(false);
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api(`/agents/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent', id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (agent.isError) return <ErrorState error={agent.error} onRetry={() => agent.refetch()} />;
  if (!agent.data || !draft) {
    return (
      <div aria-busy>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }
  const a = agent.data;
  const update = (fn: (c: DraftState['config']) => DraftState['config']) =>
    setDraft((d) => (d ? { ...d, config: fn(d.config) } : d));
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/agents"
            className="mb-1.5 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
          >
            <ChevronLeft className="size-3.5" aria-hidden /> Agents
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">
              {draft.name || 'Untitled agent'}
            </h1>
            <AgentStatusPill status={a.status} />
            {a.latestVersionNumber > 0 && (
              <span className="font-mono text-xs text-muted">v{a.latestVersionNumber} live</span>
            )}
            {dirty && (
              <span className="inline-flex items-center gap-1.5 text-xs text-warning" role="status">
                <span className="size-1.5 rounded-full bg-warning" aria-hidden /> Unsaved changes
              </span>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => draft && saved && setDraft(structuredClone(saved))}
              variant="ghost"
              disabled={!dirty || save.isPending}
            >
              Discard
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!dirty || hasErrors}
              loading={save.isPending}
            >
              <Save aria-hidden /> Save draft
            </Button>
            {can('agents:publish') && (
              <Button variant="primary" onClick={() => setPublishOpen(true)} disabled={dirty}>
                <Rocket aria-hidden /> Publish
              </Button>
            )}
          </div>
        )}
        {can('agents:write') && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-44 rounded-lg border border-border-strong bg-surface p-1 shadow-panel"
              >
                <Menu.Item
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-surface-2"
                  onSelect={() => archive.mutate(a.status !== 'ARCHIVED')}
                >
                  {a.status === 'ARCHIVED' ? (
                    <ArchiveRestore className="size-4 text-muted" aria-hidden />
                  ) : (
                    <Archive className="size-4 text-muted" aria-hidden />
                  )}
                  {a.status === 'ARCHIVED' ? 'Restore agent' : 'Archive agent'}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
      {readOnly && (
        <p className="rounded-md border bg-surface-2 px-3 py-2 text-[13px] text-muted">
          {a.status === 'ARCHIVED'
            ? 'This agent is archived. Restore it to edit or run it.'
            : 'You have read-only access to this agent’s configuration.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 rounded-[var(--radius-panel)] border bg-surface shadow-panel md:grid md:grid-cols-[180px_minmax(0,1fr)]">
          <nav
            aria-label="Agent configuration"
            className="flex gap-1 overflow-x-auto border-b p-2 md:flex-col md:border-r md:border-b-0 md:p-3"
          >
            {SECTIONS.map(([key, label]) => {
              const hasError =
                Object.keys(errors).some((k) =>
                  k.startsWith(key === 'overview' ? 'name' : key === 'model' ? 'model' : key),
                ) && key !== 'versions';
              return (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  aria-current={section === key ? 'page' : undefined}
                  className={cn(
                    'flex h-8 shrink-0 items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg',
                    section === key && 'bg-surface-2 text-fg',
                  )}
                >
                  {label}
                  {hasError && (
                    <span className="size-1.5 rounded-full bg-danger" aria-label="has errors" />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="min-w-0 p-5 md:p-6">
            {section === 'overview' && (
              <OverviewSection
                agent={a}
                name={draft.name}
                description={draft.description}
                onName={(name) => setDraft({ ...draft, name })}
                onDescription={(description) => setDraft({ ...draft, description })}
                issues={a.issues}
                errors={errors}
                readOnly={readOnly}
              />
            )}
            {section === 'instructions' && (
              <InstructionsSection
                config={draft.config}
                update={update}
                errors={errors}
                readOnly={readOnly}
              />
            )}
            {section === 'model' && (
              <ModelSection
                config={draft.config}
                update={update}
                catalog={catalog.data}
                errors={errors}
                readOnly={readOnly}
              />
            )}
            {section === 'tools' && (
              <ToolsSection
                config={draft.config}
                update={update}
                tools={tools.data}
                readOnly={readOnly}
              />
            )}
            {section === 'permissions' && (
              <PermissionsSection config={draft.config} tools={tools.data} />
            )}
            {section === 'limits' && (
              <LimitsSection
                config={draft.config}
                update={update}
                errors={errors}
                readOnly={readOnly}
              />
            )}
            {section === 'versions' && <VersionsSection agent={a} />}
          </div>
        </div>
        <div className="xl:sticky xl:top-20 xl:h-[calc(100dvh-7rem)]">
          <TestConsole
            agentId={id}
            dirty={dirty}
            canTestDraft={can('agents:write') && a.status !== 'ARCHIVED'}
            hasPublished={!!a.publishedVersionId && a.status !== 'ARCHIVED'}
          />
        </div>
      </div>
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} agent={a} />
    </div>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agent: AgentDetail;
}) {
  const qc = useQueryClient();
  const [changelog, setChangelog] = useState('');
  const blocking = agent.issues.filter((i) => i.severity === 'error');
  const warnings = agent.issues.filter((i) => i.severity === 'warning');
  const publish = useMutation({
    mutationFn: () =>
      api<{ version: number }>(`/agents/${agent.id}/publish`, {
        body: { revision: agent.draftRevision, changelog },
      }),
    onSuccess: (v) => {
      toast.success(`Published v${v.version}`);
      onOpenChange(false);
      setChangelog('');
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Publish v${agent.latestVersionNumber + 1}`}
      description="Publishing snapshots the saved draft into an immutable version. New production runs use it immediately."
    >
      <div className="grid gap-4">
        {blocking.length > 0 && (
          <ul
            role="alert"
            className="grid gap-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px]"
          >
            {blocking.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[13px]">
            <div className="mb-1 font-medium">Review before publishing</div>
            <ul className="list-disc space-y-0.5 pl-4 text-muted">
              {warnings.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
        <Field
          label="Changelog"
          htmlFor="changelog"
          hint="Optional. Shown in version history and the audit log."
        >
          <Textarea
            id="changelog"
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            maxLength={500}
            className="min-h-20"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => publish.mutate()}
            loading={publish.isPending}
            disabled={blocking.length > 0}
          >
            Publish
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

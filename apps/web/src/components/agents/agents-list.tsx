'use client';
import { createAgentSchema } from '@nexa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { AgentStatusPill } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useCan } from '@/hooks/use-session';
import { api, ApiError, issuesToErrors } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import type { AgentSummary } from '@/lib/types';

const FILTERS = [
  ['', 'Active'],
  ['PUBLISHED', 'Published'],
  ['DRAFT', 'Drafts'],
  ['ARCHIVED', 'Archived'],
] as const;

export function AgentsList() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const agents = useQuery({
    queryKey: ['agents', status, q],
    queryFn: () =>
      api<AgentSummary[]>(
        `/agents?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`,
      ),
  });
  const createOpen = params.get('new') === '1';

  return (
    <>
      <PageHeader
        title="Agents"
        description="AI workers with instructions, a model, permitted tools and hard limits. Runs always use an immutable published version."
        actions={
          can('agents:write') && (
            <Button variant="primary" onClick={() => router.push('/agents?new=1')}>
              <Plus aria-hidden /> New agent
            </Button>
          )
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <div
            role="tablist"
            aria-label="Filter by status"
            className="inline-flex rounded-lg border border-border-strong bg-surface-2 p-0.5"
          >
            {FILTERS.map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={status === v}
                onClick={() => setStatus(v)}
                className={`h-7 rounded-md px-2.5 text-xs font-medium ${status === v ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search agents</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents"
              className="h-8 pl-8"
            />
          </label>
        </div>
        {agents.isError ? (
          <ErrorState error={agents.error} onRetry={() => agents.refetch()} />
        ) : !agents.data ? (
          <SkeletonRows />
        ) : agents.data.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title={q || status ? 'No agents match' : 'No agents yet'}
            description={
              q || status
                ? 'Try a different filter or search.'
                : 'Create your first agent, attach a tool like getOrder, and test it in the console.'
            }
            action={
              !q && !status && can('agents:write') ? (
                <Button variant="primary" size="sm" onClick={() => router.push('/agents?new=1')}>
                  <Plus aria-hidden /> Create agent
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Agent</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Version</TH>
                <TH className="text-right">Updated</TH>
              </tr>
            </THead>
            <TBody>
              {agents.data.map((a) => (
                <TR
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/agents/${a.id}`)}
                >
                  <TD>
                    <Link
                      href={`/agents/${a.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.name}
                    </Link>
                    {a.description && (
                      <div className="mt-0.5 max-w-[60ch] truncate text-[13px] text-muted">
                        {a.description}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <AgentStatusPill status={a.status} />
                  </TD>
                  <TD className="hidden font-mono text-xs text-muted sm:table-cell">
                    {a.latestVersionNumber ? `v${a.latestVersionNumber}` : '—'}
                  </TD>
                  <TD className="text-right text-xs text-muted">{fmtRelative(a.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      <CreateAgentDialog open={createOpen} onOpenChange={(o) => !o && router.replace('/agents')} />
    </>
  );
}

function CreateAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api<{ id: string }>('/agents', { body }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      router.push(`/agents/${a.id}?section=instructions`);
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError
          ? { ...e.fieldErrors(), form: e.message }
          : { form: 'Could not create agent' },
      ),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New agent"
      description="Start with a name. You’ll configure instructions, model and tools next."
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const parsed = createAgentSchema.safeParse({
            name: fd.get('name'),
            description: fd.get('description'),
          });
          if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
          setErrors({});
          create.mutate(parsed.data);
        }}
      >
        {errors.form && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.form}
          </p>
        )}
        <Field label="Name" htmlFor="agent-name" error={errors.name}>
          <Input
            id="agent-name"
            name="name"
            placeholder="Support Agent"
            autoFocus
            aria-invalid={!!errors.name}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="agent-description"
          hint="Optional. Shown to your team, not to the model."
        >
          <Textarea
            id="agent-description"
            name="description"
            className="min-h-20"
            placeholder="Answers order status questions and escalates issues."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create agent
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

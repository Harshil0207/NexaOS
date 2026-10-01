'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, PenLine, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { JsonView } from '@/components/ui/json-view';
import { PageHeader, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Badge } from '@/components/ui/status';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import type { ToolInfo } from '@/lib/types';

export default function ToolsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api<ToolInfo[]>('/tools') });
  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api(`/tools/${key}`, { method: 'PATCH', body: { enabled } }),
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: ['tools'] });
      const prev = qc.getQueryData<ToolInfo[]>(['tools']);
      qc.setQueryData<ToolInfo[]>(['tools'], (old) =>
        old?.map((t) => (t.key === key ? { ...t, enabled } : t)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['tools'], ctx?.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (_d, v) =>
      toast.success(`${v.key} ${v.enabled ? 'enabled' : 'disabled'} for the organisation`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tools'] }),
  });

  return (
    <>
      <PageHeader
        title="Tools"
        description="The registry of actions agents can request. Disabling a tool here blocks it for every agent in the organisation, immediately."
      />
      <Panel>
        {tools.isError ? (
          <ErrorState error={tools.error} onRetry={() => tools.refetch()} />
        ) : !tools.data ? (
          <SkeletonRows />
        ) : tools.data.length === 0 ? (
          <EmptyState icon={<Wrench />} title="No tools registered" />
        ) : (
          <ul className="divide-y">
            {tools.data.map((t) => (
              <li key={t.key} className="px-5 py-4">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{t.name}</h2>
                      <span className="font-mono text-xs text-muted">{t.key}</span>
                      <Badge tone={t.kind === 'MUTATION' ? 'warning' : 'neutral'}>
                        {t.kind === 'MUTATION' ? <PenLine aria-hidden /> : <Eye aria-hidden />}
                        {t.kind === 'MUTATION' ? 'Changes data' : 'Read only'}
                      </Badge>
                      <Badge
                        tone={
                          t.risk === 'high' ? 'danger' : t.risk === 'medium' ? 'warning' : 'neutral'
                        }
                      >
                        {t.risk} risk
                      </Badge>
                      {!t.available && <Badge tone="neutral">Unavailable</Badge>}
                    </div>
                    <p className="mt-1 max-w-[80ch] text-[13px] text-muted">{t.description}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Lock className="size-3" aria-hidden /> requires{' '}
                        <span className="font-mono">{t.permission}</span>
                      </span>
                      <span>
                        {t.idempotent
                          ? 'Retried automatically on transient errors'
                          : 'Never retried automatically'}
                      </span>
                    </div>
                    {!t.available && t.unavailableReason && (
                      <p className="mt-2 text-xs text-warning">
                        Not configured on this server: {t.unavailableReason}
                      </p>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted hover:text-fg">
                        Input schema
                      </summary>
                      <JsonView value={t.inputSchema} className="mt-2" />
                    </details>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-xs text-muted">{t.enabled ? 'Enabled' : 'Disabled'}</span>
                    <Switch
                      checked={t.enabled}
                      disabled={!can('tools:manage')}
                      onCheckedChange={(enabled) => toggle.mutate({ key: t.key, enabled })}
                      aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${t.name}`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {!can('tools:manage') && (
        <p className="mt-3 text-xs text-muted">
          Only admins and owners can change organisation tool settings.
        </p>
      )}
    </>
  );
}

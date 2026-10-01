'use client';
import { EXECUTION_STATUSES } from '@nexa/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useState } from 'react';
import { ExecutionsTable } from '@/components/executions/executions-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useCursorList } from '@/hooks/use-cursor-list';
import { api } from '@/lib/api';
import type { AgentSummary, ExecutionSummary } from '@/lib/types';

const LABEL: Record<string, string> = {
  WAITING_FOR_TOOL: 'Calling tool',
  WAITING_FOR_APPROVAL: 'Awaiting approval',
  TIMED_OUT: 'Timed out',
};

export default function ExecutionsPage() {
  const [status, setStatus] = useState('');
  const [agentId, setAgentId] = useState('');
  const agents = useQuery({
    queryKey: ['agents', '', ''],
    queryFn: () => api<AgentSummary[]>('/agents'),
  });
  const list = useCursorList<ExecutionSummary>(['executions'], '/executions', {
    status: status || undefined,
    agentId: agentId || undefined,
    limit: '25',
  });
  const filtered = !!status || !!agentId;

  return (
    <>
      <PageHeader
        title="Executions"
        description="Every agent run with its status, duration, tokens and cost. Updates live."
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Status
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-44">
              <option value="">All statuses</option>
              {EXECUTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s] ?? s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Agent
            <Select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-8 w-52"
            >
              <option value="">All agents</option>
              {agents.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatus('');
                setAgentId('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.items ? (
          <SkeletonRows rows={8} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            title={filtered ? 'No runs match these filters' : 'No runs yet'}
            description={
              filtered ? undefined : 'Run an agent from its test console to see executions here.'
            }
          />
        ) : (
          <>
            <ExecutionsTable rows={list.items} />
            {list.hasNextPage && (
              <div className="border-t px-5 py-3 text-center">
                <Button
                  size="sm"
                  onClick={() => list.fetchNextPage()}
                  loading={list.isFetchingNextPage}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

'use client';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useState } from 'react';
import { StackedBarChart } from '@/components/charts/bar-chart';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Stat } from '@/components/ui/stat';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtCompact, fmtCost, fmtNumber } from '@/lib/format';

interface Usage {
  series: {
    day: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    calls: number;
    completed: number;
    failed: number;
  }[];
  byModel: {
    model: string;
    costMicros: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }[];
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['usage', days],
    queryFn: () => api<Usage>(`/usage?days=${days}`),
  });
  const totals = q.data?.series.reduce(
    (a, s) => ({
      cost: a.cost + s.costMicros,
      input: a.input + s.inputTokens,
      output: a.output + s.outputTokens,
      calls: a.calls + s.calls,
    }),
    { cost: 0, input: 0, output: 0, calls: 0 },
  );
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <>
      <PageHeader
        title="Usage & cost"
        description="Model consumption recorded per call. Costs are estimates from the configured price list; models without a price are counted as $0 and flagged in run details."
        actions={
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5"
          >
            {[7, 30, 90].map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={`h-7 rounded-md px-2.5 text-xs font-medium ${days === r ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'}`}
              >
                {r}d
              </button>
            ))}
          </div>
        }
      />
      {q.isError ? (
        <Panel>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              loading={!totals}
              label="Estimated cost"
              value={fmtCost(totals?.cost ?? 0)}
              icon={<Coins />}
            />
            <Stat loading={!totals} label="Model calls" value={fmtNumber(totals?.calls ?? 0)} />
            <Stat loading={!totals} label="Input tokens" value={fmtCompact(totals?.input ?? 0)} />
            <Stat loading={!totals} label="Output tokens" value={fmtCompact(totals?.output ?? 0)} />
          </div>
          <Panel className="mt-6">
            <PanelHeader title="Daily spend" description="Estimated USD per day" />
            <div className="px-5 py-4">
              {!q.data ? (
                <div className="h-44 animate-pulse rounded-md bg-surface-2" />
              ) : totals?.calls === 0 ? (
                <EmptyState
                  title="No model usage in this period"
                  description="Usage is recorded the moment an agent calls a model."
                />
              ) : (
                <StackedBarChart
                  title="Estimated spend per day"
                  data={q.data.series.map((s) => ({ ...s, label: label(s.day) }))}
                  series={[{ key: 'costMicros', label: 'Estimated spend', color: 'var(--accent)' }]}
                  value={(r, k) => r[k as 'costMicros']}
                  format={(n) => fmtCost(n)}
                />
              )}
            </div>
          </Panel>
          <Panel className="mt-6">
            <PanelHeader title="By model" />
            {!q.data ? (
              <SkeletonRows rows={2} />
            ) : q.data.byModel.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">No models used yet.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Model</TH>
                    <TH className="text-right">Calls</TH>
                    <TH className="text-right">Input</TH>
                    <TH className="text-right">Output</TH>
                    <TH className="text-right">Cost</TH>
                  </tr>
                </THead>
                <TBody>
                  {q.data.byModel
                    .sort((a, b) => b.costMicros - a.costMicros)
                    .map((m) => (
                      <TR key={m.model}>
                        <TD className="font-mono text-[13px]">{m.model}</TD>
                        <TD className="text-right font-mono text-xs tabular">
                          {fmtNumber(m.calls)}
                        </TD>
                        <TD className="text-right font-mono text-xs tabular">
                          {fmtNumber(m.inputTokens)}
                        </TD>
                        <TD className="text-right font-mono text-xs tabular">
                          {fmtNumber(m.outputTokens)}
                        </TD>
                        <TD className="text-right font-mono text-xs tabular">
                          {fmtCost(m.costMicros)}
                        </TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

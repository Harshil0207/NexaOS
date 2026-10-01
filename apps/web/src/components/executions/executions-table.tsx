'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExecutionStatusPill } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  durationBetween,
  fmtCost,
  fmtDuration,
  fmtNumber,
  fmtRelative,
  shortId,
} from '@/lib/format';
import type { ExecutionSummary } from '@/lib/types';

type Row = Pick<
  ExecutionSummary,
  | 'id'
  | 'agentName'
  | 'status'
  | 'triggerSource'
  | 'createdAt'
  | 'startedAt'
  | 'finishedAt'
  | 'costMicros'
> &
  Partial<Pick<ExecutionSummary, 'input' | 'inputTokens' | 'outputTokens'>>;

export function ExecutionsTable({ rows, compact }: { rows: Row[]; compact?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <tr>
          <TH>Run</TH>
          <TH>Agent</TH>
          <TH>Status</TH>
          {!compact && <TH className="hidden md:table-cell">Input</TH>}
          <TH className="hidden sm:table-cell">Trigger</TH>
          <TH className="text-right">Duration</TH>
          {!compact && <TH className="hidden text-right lg:table-cell">Tokens</TH>}
          <TH className="text-right">Cost</TH>
          <TH className="text-right">Started</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR
            key={r.id}
            className="cursor-pointer"
            onClick={() => router.push(`/executions/${r.id}`)}
          >
            <TD>
              <Link
                href={`/executions/${r.id}`}
                className="font-mono text-xs text-muted hover:text-fg"
                onClick={(e) => e.stopPropagation()}
              >
                {shortId(r.id)}
              </Link>
            </TD>
            <TD className="max-w-48 truncate font-medium">{r.agentName}</TD>
            <TD>
              <ExecutionStatusPill status={r.status} />
            </TD>
            {!compact && (
              <TD className="hidden max-w-72 truncate text-muted md:table-cell">{r.input}</TD>
            )}
            <TD className="hidden text-xs text-muted sm:table-cell">
              {r.triggerSource.replace('_', ' ').toLowerCase()}
            </TD>
            <TD className="text-right font-mono text-xs tabular">
              {fmtDuration(durationBetween(r.startedAt, r.finishedAt))}
            </TD>
            {!compact && (
              <TD className="hidden text-right font-mono text-xs tabular lg:table-cell">
                {fmtNumber((r.inputTokens ?? 0) + (r.outputTokens ?? 0))}
              </TD>
            )}
            <TD className="text-right font-mono text-xs tabular">{fmtCost(r.costMicros)}</TD>
            <TD className="whitespace-nowrap text-right text-xs text-muted">
              <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
                {fmtRelative(r.createdAt)}
              </time>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

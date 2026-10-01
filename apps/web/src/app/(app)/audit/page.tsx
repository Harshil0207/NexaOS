'use client';
import { Download, ScrollText, Search } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyId } from '@/components/ui/copy';
import { Input, Select } from '@/components/ui/input';
import { JsonView } from '@/components/ui/json-view';
import { PageHeader, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Badge } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useCursorList } from '@/hooks/use-cursor-list';
import { fmtDateTime } from '@/lib/format';
import type { AuditRow } from '@/lib/types';

const RESOURCES = [
  'agent',
  'execution',
  'tool',
  'membership',
  'organization',
  'user',
  'session',
  'order',
  'customer',
];

function toCsv(rows: AuditRow[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = [
    'time',
    'actor_type',
    'actor_id',
    'action',
    'resource_type',
    'resource_id',
    'request_id',
    'metadata',
  ];
  return [
    head.join(','),
    ...rows.map((r) =>
      [
        r.createdAt,
        r.actorType,
        r.actorId,
        r.action,
        r.resourceType,
        r.resourceId,
        r.requestId,
        JSON.stringify(r.metadata),
      ]
        .map(esc)
        .join(','),
    ),
  ].join('\n');
}

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [resourceType, setResourceType] = useState('');
  const q = useDeferredValue(search.trim()) || undefined;
  const list = useCursorList<AuditRow>(['audit'], '/audit-logs', {
    q,
    resourceType: resourceType || undefined,
    limit: '50',
  });
  const [open, setOpen] = useState<string | null>(null);

  const exportCsv = () => {
    const blob = new Blob([toCsv(list.items ?? [])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexaos-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every important change, by people, agents and the system. Entries cannot be edited or deleted."
        actions={
          <Button onClick={exportCsv} disabled={!list.items?.length}>
            <Download aria-hidden /> Export loaded rows
          </Button>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search action or resource id</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action or resource id"
              className="h-8 pl-8"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Resource
            <Select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="h-8 w-40"
            >
              <option value="">All</option>
              {RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.items ? (
          <SkeletonRows rows={10} />
        ) : list.items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No matching events" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH className="hidden md:table-cell">Resource</TH>
                  <TH className="hidden lg:table-cell">Request</TH>
                  <TH className="sr-only">Details</TH>
                </tr>
              </THead>
              <TBody>
                {list.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD className="whitespace-nowrap font-mono text-xs text-muted">
                        {fmtDateTime(r.createdAt)}
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            r.actorType === 'AGENT'
                              ? 'accent'
                              : r.actorType === 'SYSTEM'
                                ? 'neutral'
                                : 'info'
                          }
                        >
                          {r.actorType.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD className="font-mono text-[13px]">{r.action}</TD>
                      <TD className="hidden text-[13px] md:table-cell">
                        <span className="text-muted">{r.resourceType}</span>{' '}
                        {r.resourceId &&
                          (r.resourceType === 'execution' || r.resourceType === 'agent' ? (
                            <Link
                              href={`/${r.resourceType}s/${r.resourceId}`}
                              className="font-mono text-xs text-accent hover:underline"
                            >
                              {r.resourceId.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs">{r.resourceId.slice(0, 18)}</span>
                          ))}
                      </TD>
                      <TD className="hidden lg:table-cell">
                        {r.requestId && (
                          <CopyId value={r.requestId} display={r.requestId.slice(0, 8)} />
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open === r.id}
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                        >
                          {open === r.id ? 'Hide' : 'Details'}
                        </Button>
                      </TD>
                    </TR>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6} className="bg-surface-2/40 px-5 py-3">
                          <JsonView
                            value={{ actorId: r.actorId, ip: r.ip, metadata: r.metadata }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
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

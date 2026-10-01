'use client';
import { createCustomerSchema, createOrderSchema, ORDER_STATUSES } from '@nexa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Badge } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCursorList } from '@/hooks/use-cursor-list';
import { useCan } from '@/hooks/use-session';
import { api, ApiError, errorMessage, issuesToErrors } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import type { Page } from '@/lib/types';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  createdAt: string;
  customer: { id: string; name: string; email: string };
}
interface CustomerRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}
interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  createdByExecutionId: string | null;
  orderNumber: string | null;
}

const money = (c: number, cur: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="relative w-full sm:w-64">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="h-8 pl-8"
      />
    </label>
  );
}

function LoadMore({
  list,
}: {
  list: { hasNextPage: boolean; fetchNextPage: () => unknown; isFetchingNextPage: boolean };
}) {
  if (!list.hasNextPage) return null;
  return (
    <div className="border-t px-5 py-3 text-center">
      <Button size="sm" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
        Load more
      </Button>
    </div>
  );
}

export default function RecordsPage() {
  const can = useCan();
  const [tab, setTab] = useState('orders');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim()) || undefined;
  const orders = useCursorList<OrderRow>(['records', 'orders'], '/records/orders', {
    q,
    limit: '25',
  });
  const customers = useCursorList<CustomerRow>(['records', 'customers'], '/records/customers', {
    q,
    limit: '25',
  });
  const tickets = useCursorList<TicketRow>(['records', 'tickets'], '/records/tickets', {
    q,
    limit: '25',
  });
  const [dialog, setDialog] = useState<'order' | 'customer' | null>(null);

  return (
    <>
      <PageHeader
        title="Business data"
        description="The organisation’s records that tools read and write. Agents only ever see this organisation’s data."
        actions={
          can('records:write') && (
            <>
              <Button onClick={() => setDialog('customer')}>
                <Plus aria-hidden /> Customer
              </Button>
              <Button variant="primary" onClick={() => setDialog('order')}>
                <Plus aria-hidden /> Order
              </Button>
            </>
          )
        }
      />
      <Panel>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-2">
            <TabsList className="border-b-0">
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="customers">Customers</TabsTrigger>
              <TabsTrigger value="tickets">Support tickets</TabsTrigger>
            </TabsList>
            <div className="pb-2">
              <SearchBox value={search} onChange={setSearch} label={`Search ${tab}`} />
            </div>
          </div>
          <div className="border-t" />
          <TabsContent value="orders">
            {orders.isError ? (
              <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
            ) : !orders.items ? (
              <SkeletonRows />
            ) : orders.items.length === 0 ? (
              <EmptyState
                icon={<Database />}
                title={q ? 'No matching orders' : 'No orders yet'}
                description={
                  q
                    ? undefined
                    : 'Add orders so agents with getOrder can answer questions about them.'
                }
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH>Order</TH>
                      <TH>Customer</TH>
                      <TH>Status</TH>
                      <TH className="hidden md:table-cell">Carrier</TH>
                      <TH className="hidden lg:table-cell">ETA</TH>
                      <TH className="text-right">Total</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {orders.items.map((o) => (
                      <TR key={o.id}>
                        <TD className="font-mono text-[13px]">#{o.orderNumber}</TD>
                        <TD>
                          <div className="font-medium">{o.customer.name}</div>
                          <div className="text-xs text-muted">{o.customer.email}</div>
                        </TD>
                        <TD>
                          <Badge
                            tone={
                              o.status === 'DELIVERED'
                                ? 'success'
                                : o.status === 'CANCELLED' || o.status === 'RETURNED'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {o.status.toLowerCase()}
                          </Badge>
                        </TD>
                        <TD className="hidden text-[13px] md:table-cell">
                          {o.carrier ?? '—'}
                          {o.trackingNumber && (
                            <div className="font-mono text-xs text-muted">{o.trackingNumber}</div>
                          )}
                        </TD>
                        <TD className="hidden text-[13px] lg:table-cell">
                          {o.estimatedDelivery ?? '—'}
                        </TD>
                        <TD className="text-right font-mono text-[13px] tabular">
                          {money(o.totalCents, o.currency)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <LoadMore list={orders} />
              </>
            )}
          </TabsContent>
          <TabsContent value="customers">
            {customers.isError ? (
              <ErrorState error={customers.error} onRetry={() => customers.refetch()} />
            ) : !customers.items ? (
              <SkeletonRows />
            ) : customers.items.length === 0 ? (
              <EmptyState
                icon={<Database />}
                title={q ? 'No matching customers' : 'No customers yet'}
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH>Name</TH>
                      <TH>Email</TH>
                      <TH className="text-right">Added</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {customers.items.map((c) => (
                      <TR key={c.id}>
                        <TD className="font-medium">{c.name}</TD>
                        <TD className="text-muted">{c.email}</TD>
                        <TD className="text-right text-xs text-muted">
                          {fmtRelative(c.createdAt)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <LoadMore list={customers} />
              </>
            )}
          </TabsContent>
          <TabsContent value="tickets">
            {tickets.isError ? (
              <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
            ) : !tickets.items ? (
              <SkeletonRows />
            ) : tickets.items.length === 0 ? (
              <EmptyState
                icon={<Database />}
                title="No support tickets"
                description="Tickets created by agents with createSupportTicket appear here."
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH>Subject</TH>
                      <TH>Priority</TH>
                      <TH className="hidden md:table-cell">Order</TH>
                      <TH className="hidden md:table-cell">Created by</TH>
                      <TH className="text-right">Created</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {tickets.items.map((t) => (
                      <TR key={t.id}>
                        <TD className="font-medium">{t.subject}</TD>
                        <TD>
                          <Badge
                            tone={
                              t.priority === 'URGENT' || t.priority === 'HIGH'
                                ? 'warning'
                                : 'neutral'
                            }
                          >
                            {t.priority.toLowerCase()}
                          </Badge>
                        </TD>
                        <TD className="hidden font-mono text-xs md:table-cell">
                          {t.orderNumber ? `#${t.orderNumber}` : '—'}
                        </TD>
                        <TD className="hidden text-xs md:table-cell">
                          {t.createdByExecutionId ? (
                            <Link
                              className="font-mono text-accent hover:underline"
                              href={`/executions/${t.createdByExecutionId}`}
                            >
                              agent run {t.createdByExecutionId.slice(0, 8)}
                            </Link>
                          ) : (
                            'person'
                          )}
                        </TD>
                        <TD className="text-right text-xs text-muted">
                          {fmtRelative(t.createdAt)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <LoadMore list={tickets} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </Panel>
      <CustomerDialog
        open={dialog === 'customer'}
        onOpenChange={(o) => setDialog(o ? 'customer' : null)}
      />
      <OrderDialog open={dialog === 'order'} onOpenChange={(o) => setDialog(o ? 'order' : null)} />
    </>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: { name: string; email: string }) => api('/records/customers', { body }),
    onSuccess: () => {
      toast.success('Customer added');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['records'] });
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError ? { ...e.fieldErrors(), form: e.message } : { form: errorMessage(e) },
      ),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add customer">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const p = createCustomerSchema.safeParse(
            Object.fromEntries(new FormData(e.currentTarget)),
          );
          if (!p.success) return setErrors(issuesToErrors(p.error.issues));
          setErrors({});
          m.mutate(p.data);
        }}
      >
        {errors.form && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.form}
          </p>
        )}
        <Field label="Name" htmlFor="c-name" error={errors.name}>
          <Input id="c-name" name="name" autoFocus aria-invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="c-email" error={errors.email}>
          <Input id="c-email" name="email" type="email" aria-invalid={!!errors.email} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={m.isPending}>
            Add customer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const customers = useQuery({
    queryKey: ['records', 'customers', 'all'],
    queryFn: () => api<Page<CustomerRow>>('/records/customers?limit=100'),
    enabled: open,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: object) => api('/records/orders', { body: body as Record<string, unknown> }),
    onSuccess: () => {
      toast.success('Order added');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['records'] });
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError ? { ...e.fieldErrors(), form: e.message } : { form: errorMessage(e) },
      ),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add order" className="max-w-xl">
      {customers.data?.items.length === 0 ? (
        <p className="text-[13px] text-muted">Add a customer first; every order belongs to one.</p>
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            const p = createOrderSchema.safeParse({
              ...fd,
              totalCents: Math.round(Number(fd.total) * 100),
              carrier: fd.carrier || undefined,
              trackingNumber: fd.trackingNumber || undefined,
              estimatedDelivery: fd.estimatedDelivery || undefined,
            });
            if (!p.success) {
              const e = issuesToErrors(p.error.issues);
              if (e.totalCents) e.total = e.totalCents;
              return setErrors(e);
            }
            setErrors({});
            m.mutate(p.data);
          }}
        >
          {errors.form && (
            <p role="alert" className="text-[13px] text-danger sm:col-span-2">
              {errors.form}
            </p>
          )}
          <Field label="Order number" htmlFor="o-num" error={errors.orderNumber}>
            <Input
              id="o-num"
              name="orderNumber"
              placeholder="1234"
              autoFocus
              aria-invalid={!!errors.orderNumber}
            />
          </Field>
          <Field label="Customer" htmlFor="o-cust" error={errors.customerId}>
            <Select id="o-cust" name="customerId">
              {customers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="o-status">
            <Select id="o-status" name="status" defaultValue="PENDING">
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Total (USD)" htmlFor="o-total" error={errors.total}>
            <Input
              id="o-total"
              name="total"
              type="number"
              min="0"
              step="0.01"
              aria-invalid={!!errors.total}
            />
          </Field>
          <Field label="Carrier" htmlFor="o-carrier">
            <Input id="o-carrier" name="carrier" />
          </Field>
          <Field label="Tracking number" htmlFor="o-track">
            <Input id="o-track" name="trackingNumber" />
          </Field>
          <Field label="Estimated delivery" htmlFor="o-eta" error={errors.estimatedDelivery}>
            <Input id="o-eta" name="estimatedDelivery" type="date" />
          </Field>
          <input type="hidden" name="currency" value="USD" />
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              Add order
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

import { ORDER_STATUSES } from '@nexa/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { customers, orders } from '../../db/schema';
import { defineTool, ToolError } from '../tool.types';

const orderView = z.object({
  orderNumber: z.string(),
  status: z.string(),
  total: z.string(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  estimatedDelivery: z.string().nullable(),
  placedAt: z.string(),
  customer: z.object({ name: z.string(), email: z.string() }),
});

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

type Row = {
  order: typeof orders.$inferSelect;
  customer: { name: string; email: string };
};
const toView = ({ order, customer }: Row): z.infer<typeof orderView> => ({
  orderNumber: order.orderNumber,
  status: order.status,
  total: fmtMoney(order.totalCents, order.currency),
  carrier: order.carrier,
  trackingNumber: order.trackingNumber,
  estimatedDelivery: order.estimatedDelivery,
  placedAt: order.createdAt.toISOString(),
  customer,
});

export const getOrderTool = defineTool({
  key: 'getOrder',
  name: 'Get order',
  description:
    'Look up a single order by its order number (e.g. "1234" or "#1234"). Returns status, carrier, tracking number and estimated delivery.',
  kind: 'READ',
  permission: 'records:read',
  idempotent: true,
  defaultEnabled: true,
  risk: 'low',
  input: z.object({
    orderNumber: z
      .string()
      .trim()
      .transform((s) => s.replace(/^#/, ''))
      .pipe(
        z
          .string()
          .regex(/^[A-Za-z0-9-]{1,32}$/, 'Order numbers contain only letters, digits and dashes'),
      ),
  }),
  output: z.object({ found: z.boolean(), order: orderView.nullable() }),
  availability: () => ({ available: true }),
  async execute(input, ctx) {
    const [row] = await ctx.deps.db
      .select({ order: orders, customer: { name: customers.name, email: customers.email } })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.organizationId, ctx.orgId), eq(orders.orderNumber, input.orderNumber)))
      .limit(1);
    return { found: !!row, order: row ? toView(row) : null };
  },
});

export const searchOrdersTool = defineTool({
  key: 'searchOrders',
  name: 'Search orders',
  description:
    'List recent orders, optionally filtered by customer email and/or status. Returns at most 20 orders.',
  kind: 'READ',
  permission: 'records:read',
  idempotent: true,
  defaultEnabled: true,
  risk: 'low',
  input: z.object({
    customerEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  output: z.object({ orders: z.array(orderView) }),
  availability: () => ({ available: true }),
  async execute(input, ctx) {
    const where = [eq(orders.organizationId, ctx.orgId)];
    if (input.customerEmail) where.push(eq(customers.email, input.customerEmail));
    if (input.status) where.push(eq(orders.status, input.status));
    const rows = await ctx.deps.db
      .select({ order: orders, customer: { name: customers.name, email: customers.email } })
      .from(orders)
      .innerJoin(
        customers,
        and(eq(customers.id, orders.customerId), eq(customers.organizationId, ctx.orgId)),
      )
      .where(and(...where))
      .orderBy(desc(orders.createdAt))
      .limit(input.limit);
    return { orders: rows.map(toView) };
  },
});

export { ToolError };

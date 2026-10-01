import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUniqueViolation } from '../../common/pg-errors';
import { orders, supportTickets } from '../../db/schema';
import { defineTool, ToolError } from '../tool.types';

export const createSupportTicketTool = defineTool({
  key: 'createSupportTicket',
  name: 'Create support ticket',
  description:
    'Create a support ticket for a human support team to follow up. Optionally link it to an order number.',
  kind: 'MUTATION',
  permission: 'records:write',
  // Retry-safe because the handler dedupes on the call's idempotency key.
  idempotent: true,
  defaultEnabled: true,
  risk: 'medium',
  input: z.object({
    subject: z.string().trim().min(3).max(200),
    body: z.string().trim().min(3).max(5000),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    orderNumber: z
      .string()
      .trim()
      .transform((s) => s.replace(/^#/, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9-]{1,32}$/))
      .optional(),
  }),
  output: z.object({ ticketId: z.string(), status: z.string(), deduplicated: z.boolean() }),
  availability: () => ({ available: true }),
  async execute(input, ctx) {
    const db = ctx.deps.db;
    const existing = await db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.organizationId, ctx.orgId),
        eq(supportTickets.idempotencyKey, ctx.idempotencyKey),
      ),
    });
    if (existing) return { ticketId: existing.id, status: existing.status, deduplicated: true };

    let orderId: string | null = null;
    let customerId: string | null = null;
    if (input.orderNumber) {
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.organizationId, ctx.orgId), eq(orders.orderNumber, input.orderNumber)),
      });
      if (!order)
        throw new ToolError('ORDER_NOT_FOUND', `Order ${input.orderNumber} does not exist`);
      orderId = order.id;
      customerId = order.customerId;
    }
    try {
      const [t] = await db
        .insert(supportTickets)
        .values({
          organizationId: ctx.orgId,
          subject: input.subject,
          body: input.body,
          priority: input.priority,
          orderId,
          customerId,
          createdByExecutionId: ctx.executionId,
          idempotencyKey: ctx.idempotencyKey,
        })
        .returning();
      return { ticketId: t!.id, status: t!.status, deduplicated: false };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const t = await db.query.supportTickets.findFirst({
          where: and(
            eq(supportTickets.organizationId, ctx.orgId),
            eq(supportTickets.idempotencyKey, ctx.idempotencyKey),
          ),
        });
        if (t) return { ticketId: t.id, status: t.status, deduplicated: true };
      }
      throw err;
    }
  },
});

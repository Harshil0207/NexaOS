import { Inject, Injectable } from '@nestjs/common';
import { CreateOrderInput, ORDER_STATUSES } from '@nexa/shared';
import { and, desc, eq, ilike, lt, or, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { decodeCursor, page } from '../common/pagination';
import { isUniqueViolation } from '../common/pg-errors';
import type { OrgContext } from '../common/request-context';
import { DB, Database } from '../db/db.module';
import { customers, orders, supportTickets } from '../db/schema';

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  q: z.string().trim().max(80).optional(),
});

const like = (s: string) => `%${s.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

@Injectable()
export class RecordsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listCustomers(ctx: OrgContext, q: z.infer<typeof listQuery>) {
    const where: SQL[] = [eq(customers.organizationId, ctx.orgId)];
    if (q.q) where.push(or(ilike(customers.name, like(q.q)), ilike(customers.email, like(q.q)))!);
    const cursor = decodeCursor(q.cursor);
    if (cursor)
      where.push(
        or(
          lt(customers.createdAt, cursor.createdAt),
          and(eq(customers.createdAt, cursor.createdAt), lt(customers.id, cursor.id)),
        )!,
      );
    const rows = await this.db
      .select()
      .from(customers)
      .where(and(...where))
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }

  async createCustomer(ctx: OrgContext, input: { name: string; email: string }) {
    try {
      return await this.db.transaction(async (tx) => {
        const [c] = await tx
          .insert(customers)
          .values({ organizationId: ctx.orgId, ...input })
          .returning();
        await this.audit.record(
          { kind: 'user', ctx },
          { action: 'customer.created', resourceType: 'customer', resourceId: c!.id },
          tx,
        );
        return c!;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw Errors.conflict('A customer with this email already exists');
      throw err;
    }
  }

  async listOrders(ctx: OrgContext, q: z.infer<typeof listQuery>) {
    const where: SQL[] = [eq(orders.organizationId, ctx.orgId)];
    if (q.q)
      where.push(
        or(
          ilike(orders.orderNumber, like(q.q.replace(/^#/, ''))),
          ilike(customers.email, like(q.q)),
        )!,
      );
    const cursor = decodeCursor(q.cursor);
    if (cursor)
      where.push(
        or(
          lt(orders.createdAt, cursor.createdAt),
          and(eq(orders.createdAt, cursor.createdAt), lt(orders.id, cursor.id)),
        )!,
      );
    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalCents: orders.totalCents,
        currency: orders.currency,
        carrier: orders.carrier,
        trackingNumber: orders.trackingNumber,
        estimatedDelivery: orders.estimatedDelivery,
        createdAt: orders.createdAt,
        customer: { id: customers.id, name: customers.name, email: customers.email },
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...where))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }

  async createOrder(ctx: OrgContext, input: CreateOrderInput) {
    const customer = await this.db.query.customers.findFirst({
      where: and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.orgId)),
    });
    if (!customer) throw Errors.notFound('Customer');
    try {
      return await this.db.transaction(async (tx) => {
        const [o] = await tx
          .insert(orders)
          .values({ organizationId: ctx.orgId, ...input })
          .returning();
        await this.audit.record(
          { kind: 'user', ctx },
          {
            action: 'order.created',
            resourceType: 'order',
            resourceId: o!.id,
            metadata: { orderNumber: o!.orderNumber },
          },
          tx,
        );
        return o!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('An order with this number already exists');
      throw err;
    }
  }

  async updateOrderStatus(ctx: OrgContext, id: string, status: (typeof ORDER_STATUSES)[number]) {
    await this.db.transaction(async (tx) => {
      const [o] = await tx
        .update(orders)
        .set({ status })
        .where(and(eq(orders.id, id), eq(orders.organizationId, ctx.orgId)))
        .returning({ id: orders.id });
      if (!o) throw Errors.notFound('Order');
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'order.status_changed',
          resourceType: 'order',
          resourceId: id,
          metadata: { status },
        },
        tx,
      );
    });
  }

  async listTickets(ctx: OrgContext, q: z.infer<typeof listQuery>) {
    const where: SQL[] = [eq(supportTickets.organizationId, ctx.orgId)];
    if (q.q) where.push(ilike(supportTickets.subject, like(q.q)));
    const cursor = decodeCursor(q.cursor);
    if (cursor)
      where.push(
        or(
          lt(supportTickets.createdAt, cursor.createdAt),
          and(eq(supportTickets.createdAt, cursor.createdAt), lt(supportTickets.id, cursor.id)),
        )!,
      );
    const rows = await this.db
      .select({
        id: supportTickets.id,
        subject: supportTickets.subject,
        body: supportTickets.body,
        status: supportTickets.status,
        priority: supportTickets.priority,
        createdAt: supportTickets.createdAt,
        createdByExecutionId: supportTickets.createdByExecutionId,
        orderNumber: orders.orderNumber,
      })
      .from(supportTickets)
      .leftJoin(orders, eq(orders.id, supportTickets.orderId))
      .where(and(...where))
      .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }
}

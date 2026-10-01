/**
 * DEVELOPMENT SEED DATA ONLY. Refuses to run in production.
 * Creates a demo organisation with realistic records and two agents so the UI has
 * something to explore. Production screens never depend on this data.
 */
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as s from '../src/db/schema';

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to seed a production database.\n');
  process.exit(1);
}

const EMAIL = process.env.SEED_EMAIL ?? 'owner@nexaos.dev';
const PASSWORD = process.env.SEED_PASSWORD ?? 'nexaos-dev-password-1';
const MODEL = process.env.LLM_DEFAULT_MODEL ?? 'claude-haiku-4-5';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  const existing = await db.query.users.findFirst({ where: eq(s.users.email, EMAIL) });
  if (existing) {
    process.stdout.write(`Seed user ${EMAIL} already exists; nothing to do.\n`);
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(s.users)
      .values({
        email: EMAIL,
        name: 'Demo Owner',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      })
      .returning();
    const [org] = await tx
      .insert(s.organizations)
      .values({ name: 'Acme Retail (Demo)', slug: `acme-demo-${Date.now().toString(36)}` })
      .returning();
    await tx
      .insert(s.memberships)
      .values({ organizationId: org!.id, userId: user!.id, role: 'OWNER' });

    const people = [
      ['Jane Cooper', 'jane.cooper@example.com'],
      ['Wade Warren', 'wade.warren@example.com'],
      ['Esther Howard', 'esther.howard@example.com'],
    ] as const;
    const customers = await tx
      .insert(s.customers)
      .values(people.map(([name, email]) => ({ organizationId: org!.id, name, email })))
      .returning();
    await tx.insert(s.orders).values([
      {
        organizationId: org!.id,
        orderNumber: '1234',
        customerId: customers[0]!.id,
        status: 'SHIPPED',
        totalCents: 12_999,
        carrier: 'UPS',
        trackingNumber: '1Z999AA10123456784',
        estimatedDelivery: '2026-10-02',
      },
      {
        organizationId: org!.id,
        orderNumber: '1235',
        customerId: customers[0]!.id,
        status: 'DELIVERED',
        totalCents: 4_500,
        carrier: 'USPS',
        trackingNumber: '9400111899223856925',
        estimatedDelivery: '2026-09-20',
      },
      {
        organizationId: org!.id,
        orderNumber: '1240',
        customerId: customers[1]!.id,
        status: 'PROCESSING',
        totalCents: 89_000,
      },
      {
        organizationId: org!.id,
        orderNumber: '1241',
        customerId: customers[2]!.id,
        status: 'CANCELLED',
        totalCents: 2_150,
      },
    ]);

    const limits = { maxSteps: 8, timeoutSeconds: 120, maxTotalTokens: 50_000 };
    const model = { provider: 'anthropic', model: MODEL, temperature: 0.2, maxOutputTokens: 1024 };
    const supportConfig = {
      instructions:
        'You are the customer support agent for Acme Retail. Answer questions about orders using the getOrder and searchOrders tools. ' +
        'Quote the order status, carrier, tracking number and estimated delivery date when available. ' +
        'If a customer reports a problem you cannot resolve, create a support ticket and share the ticket id. Never invent order details.',
      model,
      tools: ['getOrder', 'searchOrders', 'createSupportTicket'],
      limits,
    };
    const [support] = await tx
      .insert(s.agents)
      .values({
        organizationId: org!.id,
        name: 'Support Agent',
        description: 'Answers order status questions and escalates issues as tickets.',
        draftConfig: supportConfig,
        createdById: user!.id,
        draftRevision: 1,
      })
      .returning();
    const [v1] = await tx
      .insert(s.agentVersions)
      .values({
        organizationId: org!.id,
        agentId: support!.id,
        version: 1,
        config: supportConfig,
        changelog: 'Initial version (seed)',
        createdById: user!.id,
      })
      .returning();
    await tx
      .update(s.agents)
      .set({ status: 'PUBLISHED', publishedVersionId: v1!.id, latestVersionNumber: 1 })
      .where(and(eq(s.agents.id, support!.id)));

    await tx.insert(s.agents).values({
      organizationId: org!.id,
      name: 'Invoice Agent',
      description: 'Summarises order totals for a customer (draft).',
      draftConfig: {
        instructions:
          'Summarise a customer’s orders and totals using searchOrders. Present amounts in the order currency.',
        model,
        tools: ['searchOrders'],
        limits,
      },
      createdById: user!.id,
    });
    await tx.insert(s.auditLogs).values({
      organizationId: org!.id,
      actorType: 'SYSTEM',
      action: 'seed.applied',
      resourceType: 'organization',
      resourceId: org!.id,
      metadata: { note: 'development seed data' },
    });
  });

  process.stdout.write(
    `Seeded demo data.\n  Login: ${EMAIL}\n  Password: ${PASSWORD} (development only)\n`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CoreModule } from '../src/core.module';
import { DB, Database } from '../src/db/db.module';
import { auditLogs, executions } from '../src/db/schema';
import { LlmRegistry } from '../src/llm/llm.registry';
import { LlmError } from '../src/llm/llm.types';
import { WorkerModule } from '../src/runtime/worker.module';
import { FakeLlmProvider, text, toolUse } from './fake-llm';
import {
  createOrg,
  orgWithMember,
  registerUser,
  resetRateLimits,
  startApp,
  waitFor,
  type Client,
} from './helpers';

let app: INestApplication;
let worker: INestApplicationContext;
let db: Database;
let fake: FakeLlmProvider;
let owner: Client;
let agentId: string;
let baseUrl: string;
const redis = new Redis(process.env.REDIS_URL!);

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const config = {
  instructions: 'You are the Acme support agent. Use getOrder to answer order questions.',
  model: { provider: 'anthropic', model: 'claude-haiku-4-5', temperature: 0, maxOutputTokens: 512 },
  tools: ['getOrder', 'createSupportTicket'],
  limits: { maxSteps: 6, timeoutSeconds: 60, maxTotalTokens: 50_000 },
};

async function finished(c: Client, id: string) {
  return (
    await waitFor(
      () => c.get(`/api/v1/executions/${id}`),
      (r) => TERMINAL.includes(r.body.status),
    )
  ).body;
}

beforeAll(async () => {
  app = await startApp();
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  db = app.get(DB);
  const moduleRef = await Test.createTestingModule({
    imports: [CoreModule, WorkerModule],
  }).compile();
  worker = await moduleRef.init();
  // The worker's "anthropic" provider is replaced by a scripted test double.
  fake = new FakeLlmProvider(() => text('unused'), 'anthropic');
  worker.get(LlmRegistry).register(fake);

  owner = await registerUser(app, 'Owner');
  await createOrg(owner, 'Exec Org');
  const cust = (
    await owner
      .post('/api/v1/records/customers')
      .send({ name: 'Jane', email: 'jane@acme.test' })
      .expect(201)
  ).body;
  await owner
    .post('/api/v1/records/orders')
    .send({
      orderNumber: '1234',
      customerId: cust.id,
      status: 'SHIPPED',
      totalCents: 1000,
      carrier: 'DHL',
    })
    .expect(201);
  agentId = (await owner.post('/api/v1/agents').send({ name: 'Support Agent' }).expect(201)).body
    .id;
  await owner.patch(`/api/v1/agents/${agentId}`).send({ config, revision: 0 }).expect(200);
});
beforeEach(async () => {
  await resetRateLimits(redis);
  fake.calls = [];
  fake.script = (_r, i) =>
    i === 0
      ? toolUse([{ id: 'c1', name: 'getOrder', input: { orderNumber: '1234' } }])
      : text('Order 1234 has shipped with DHL.');
});
afterAll(async () => {
  await worker.close();
  await app.close();
  await redis.quit();
});

describe('executions API', () => {
  it('requires a published version for production runs', async () => {
    const r = await owner.post(`/api/v1/agents/${agentId}/runs`).send({ input: 'hi' }).expect(409);
    expect(r.body.error.message).toMatch(/published/);
  });

  it('runs a published agent end-to-end through the queue and worker', async () => {
    await owner
      .post(`/api/v1/agents/${agentId}/publish`)
      .send({ revision: 1, changelog: 'v1' })
      .expect(201);
    const start = await owner
      .post(`/api/v1/agents/${agentId}/runs`)
      .send({ input: 'Where is order #1234?' })
      .expect(201);
    expect(start.body.status).toBe('QUEUED');
    const exec = await finished(owner, start.body.id);
    expect(exec).toMatchObject({
      status: 'COMPLETED',
      output: 'Order 1234 has shipped with DHL.',
      agentVersion: 1,
      triggerSource: 'MANUAL',
    });
    expect(exec.toolCalls[0]).toMatchObject({ toolKey: 'getOrder', status: 'SUCCEEDED' });
    expect(exec.usage).toHaveLength(2);
    expect(exec).not.toHaveProperty('transcript');
    const events = (await owner.get(`/api/v1/executions/${exec.id}/events`).expect(200)).body;
    expect(events.map((e: { seq: number }) => e.seq)).toEqual(
      events.map((_: unknown, i: number) => i + 1),
    );
    const later = (await owner.get(`/api/v1/executions/${exec.id}/events?afterSeq=3`).expect(200))
      .body;
    expect(later[0].seq).toBe(4);
    const audit = (
      await owner.get('/api/v1/audit-logs?resourceType=execution').expect(200)
    ).body.items.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['execution.started', 'execution.completed']));
  });

  it('deduplicates runs by idempotency key', async () => {
    const key = `idem-${Date.now()}`;
    const a = await owner
      .post(`/api/v1/agents/${agentId}/runs`)
      .send({ input: 'x', idempotencyKey: key })
      .expect(201);
    const b = await owner
      .post(`/api/v1/agents/${agentId}/runs`)
      .send({ input: 'x', idempotencyKey: key })
      .expect(201);
    expect(b.body).toMatchObject({ id: a.body.id, deduplicated: true });
    await finished(owner, a.body.id);
  });

  it('lets only editors test drafts, and members run published versions', async () => {
    const { member, owner: o2 } = await orgWithMember(app, 'MEMBER');
    const a2 = (await o2.post('/api/v1/agents').send({ name: 'A2' }).expect(201)).body.id;
    await o2.patch(`/api/v1/agents/${a2}`).send({ config, revision: 0 }).expect(200);
    await member
      .post(`/api/v1/agents/${a2}/runs`)
      .send({ input: 'hi', target: 'draft' })
      .expect(403);
    await o2.post(`/api/v1/agents/${a2}/publish`).send({ revision: 1 }).expect(201);
    const r = await member
      .post(`/api/v1/agents/${a2}/runs`)
      .send({ input: 'Where is order 1234?' })
      .expect(201);
    await finished(member, r.body.id);
  });

  it('returns 404 for executions in other organisations', async () => {
    const r = await owner
      .post(`/api/v1/agents/${agentId}/runs`)
      .send({ input: 'x', target: 'draft' })
      .expect(201);
    const stranger = await registerUser(app);
    await createOrg(stranger, 'Stranger');
    await stranger.get(`/api/v1/executions/${r.body.id}`).expect(404);
    await stranger.get(`/api/v1/executions/${r.body.id}/events`).expect(404);
    await stranger.get(`/api/v1/executions/${r.body.id}/stream`).expect(404);
    await stranger.post(`/api/v1/executions/${r.body.id}/cancel`).expect(404);
    await stranger.post(`/api/v1/executions/${r.body.id}/retry`).expect(404);
    await finished(owner, r.body.id);
  });

  it('streams the timeline over SSE and resumes from Last-Event-ID without duplicates', async () => {
    const r = await owner
      .post(`/api/v1/agents/${agentId}/runs`)
      .send({ input: 'Where is order 1234?', target: 'draft' })
      .expect(201);
    const exec = await finished(owner, r.body.id);
    const total = (await owner.get(`/api/v1/executions/${exec.id}/events`)).body.length as number;
    const cookie = (
      owner as unknown as { jar: { getCookies: (o: object) => { toValueString(): string }[] } }
    ).jar
      .getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
      .map((c) => c.toValueString())
      .join('; ');

    const read = (lastEventId: number) =>
      new Promise<{ ids: number[]; ended: boolean }>((resolve, reject) => {
        const req = http.get(
          `${baseUrl}/api/v1/executions/${exec.id}/stream`,
          { headers: { cookie, 'last-event-id': String(lastEventId) } },
          (res) => {
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
            let buf = '';
            const ids: number[] = [];
            res.on('data', (d: Buffer) => {
              buf += d.toString();
              for (const m of buf.matchAll(/^id: (\d+)$/gm))
                if (!ids.includes(Number(m[1]))) ids.push(Number(m[1]));
              if (buf.includes('event: end')) {
                req.destroy();
                resolve({ ids, ended: true });
              }
            });
          },
        );
        req.on('error', (e) =>
          e.message.includes('aborted') || e.message.includes('socket hang up')
            ? undefined
            : reject(e),
        );
        setTimeout(() => reject(new Error('SSE timeout')), 5000);
      });

    const full = await read(0);
    expect(full.ids).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    const resumed = await read(3);
    expect(resumed.ids).toEqual(Array.from({ length: total - 3 }, (_, i) => i + 4));
    expect(resumed.ended).toBe(true);
  });

  it('cancels queued runs atomically and refuses to cancel finished ones', async () => {
    const [row] = await db
      .insert(executions)
      .values({
        organizationId: (await owner.get('/api/v1/organizations/current')).body.id,
        agentId,
        config,
        triggerSource: 'MANUAL',
        triggeredById: owner.userId,
        input: 'x',
        traceId: 't',
      })
      .returning();
    await owner.post(`/api/v1/executions/${row!.id}/cancel`).expect(200);
    expect((await owner.get(`/api/v1/executions/${row!.id}`)).body.status).toBe('CANCELLED');
    await owner.post(`/api/v1/executions/${row!.id}/cancel`).expect(409);
  });

  it('retries failed runs safely and refuses when side effects already happened', async () => {
    fake.script = () => {
      throw new LlmError('PROVIDER_UNAVAILABLE', 'down', false);
    };
    const failed = await finished(
      owner,
      (
        await owner
          .post(`/api/v1/agents/${agentId}/runs`)
          .send({ input: 'Where is 1234?', target: 'draft' })
          .expect(201)
      ).body.id,
    );
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });

    fake.script = (_r, i) =>
      i === 0
        ? toolUse([{ id: 'c1', name: 'getOrder', input: { orderNumber: '1234' } }])
        : text('Recovered.');
    fake.calls = [];
    const retried = await owner.post(`/api/v1/executions/${failed.id}/retry`).expect(201);
    const ok = await finished(owner, retried.body.id);
    expect(ok).toMatchObject({ status: 'COMPLETED', retryOfId: failed.id, triggerSource: 'RETRY' });
    await owner.post(`/api/v1/executions/${ok.id}/retry`).expect(409); // completed runs are not retryable

    // A run that created a ticket and then failed must not be blindly retried.
    fake.calls = [];
    fake.script = (_r, i) => {
      if (i === 0)
        return toolUse([
          {
            id: 't1',
            name: 'createSupportTicket',
            input: { subject: 'Broken', body: 'Item arrived broken', orderNumber: '1234' },
          },
        ]);
      throw new LlmError('PROVIDER_UNAVAILABLE', 'down', false);
    };
    const sideEffect = await finished(
      owner,
      (
        await owner
          .post(`/api/v1/agents/${agentId}/runs`)
          .send({ input: 'open ticket', target: 'draft' })
          .expect(201)
      ).body.id,
    );
    expect(sideEffect.status).toBe('FAILED');
    const refused = await owner.post(`/api/v1/executions/${sideEffect.id}/retry`).expect(409);
    expect(refused.body.error.message).toMatch(/side effects/);
  });

  it('paginates and filters executions with opaque cursors', async () => {
    const p1 = (await owner.get('/api/v1/executions?limit=2').expect(200)).body;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await owner.get(`/api/v1/executions?limit=2&cursor=${p1.nextCursor}`).expect(200))
      .body;
    expect(p2.items[0].id).not.toBe(p1.items[1].id);
    expect(new Date(p2.items[0].createdAt) <= new Date(p1.items[1].createdAt)).toBe(true);
    const failed = (await owner.get('/api/v1/executions?status=FAILED').expect(200)).body.items;
    expect(failed.every((e: { status: string }) => e.status === 'FAILED')).toBe(true);
    await owner.get('/api/v1/executions?status=BOGUS').expect(400);
    await owner.get('/api/v1/executions?cursor=%27%20OR%201%3D1').expect(400);
  });

  it('rate limits agent runs per user', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (
        await owner
          .post(`/api/v1/agents/${agentId}/runs`)
          .send({ input: 'x', idempotencyKey: `rl-${i}-${Date.now()}` })
      ).status;
    expect(last).toBe(429);
    await waitFor(
      () => owner.get('/api/v1/executions?status=QUEUED'),
      (r) => r.body.items.length === 0,
      20_000,
    );
  });

  it('serves real dashboard metrics and usage series', async () => {
    const d = (await owner.get('/api/v1/dashboard?days=7').expect(200)).body;
    expect(d.executions.total).toBeGreaterThan(0);
    expect(d.executions.byStatus.COMPLETED).toBeGreaterThan(0);
    expect(d.executions.byStatus.FAILED).toBeGreaterThan(0);
    expect(d.executions.successRate).toBeGreaterThan(0);
    expect(d.usage.inputTokens).toBeGreaterThan(0);
    expect(d.agents.published).toBe(1);
    expect(d.recentExecutions.length).toBeGreaterThan(0);
    expect(d.health.checks.database.ok).toBe(true);
    const u = (await owner.get('/api/v1/usage?days=7').expect(200)).body;
    expect(u.series).toHaveLength(7);
    expect(u.series.at(-1).calls).toBeGreaterThan(0);
    expect(u.byModel[0].model).toBe('fake-model');
  });
});

describe('audit log', () => {
  it('is filterable, paginated, admin-only, and append-only in the database', async () => {
    const page = (await owner.get('/api/v1/audit-logs?limit=5').expect(200)).body;
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toMatchObject({
      actorType: expect.any(String),
      action: expect.any(String),
      requestId: expect.anything(),
    });
    const filtered = (await owner.get('/api/v1/audit-logs?action=agent.published').expect(200)).body
      .items;
    expect(filtered.every((a: { action: string }) => a.action === 'agent.published')).toBe(true);

    const { member } = await orgWithMember(app, 'MANAGER');
    await member.get('/api/v1/audit-logs').expect(403);

    const [row] = await db.select().from(auditLogs).limit(1);
    await expect(
      db.update(auditLogs).set({ action: 'tampered' }).where(eq(auditLogs.id, row!.id)),
    ).rejects.toThrow();
    await expect(db.delete(auditLogs).where(eq(auditLogs.id, row!.id))).rejects.toThrow();
  });
});

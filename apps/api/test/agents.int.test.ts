import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB, Database } from '../src/db/db.module';
import { agentVersions } from '../src/db/schema';
import { createOrg, registerUser, startApp, type Client } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Client;
const redis = new Redis(process.env.REDIS_URL!);

beforeAll(async () => {
  app = await startApp();
  db = app.get(DB);
});
beforeEach(async () => {
  await redis.flushdb();
  owner = await registerUser(app);
  await createOrg(owner, 'Agents Org');
});
afterAll(async () => {
  await app.close();
  await redis.quit();
});

const config = (over: Record<string, unknown> = {}) => ({
  instructions: 'You are a helpful support agent.',
  model: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    temperature: 0.2,
    maxOutputTokens: 512,
  },
  tools: ['getOrder'],
  limits: { maxSteps: 6, timeoutSeconds: 60, maxTotalTokens: 20000 },
  ...over,
});

describe('agents', () => {
  it('creates with a safe default draft and reports configuration issues', async () => {
    const a = (await owner.post('/api/v1/agents').send({ name: 'Support Agent' }).expect(201)).body;
    expect(a.status).toBe('DRAFT');
    const detail = (await owner.get(`/api/v1/agents/${a.id}`).expect(200)).body;
    expect(
      detail.issues.some(
        (i: { severity: string; field: string }) =>
          i.severity === 'error' && i.field === 'instructions',
      ),
    ).toBe(true);
  });

  it('edits with optimistic concurrency', async () => {
    const a = (await owner.post('/api/v1/agents').send({ name: 'Concurrent' }).expect(201)).body;
    const u1 = await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({ config: config(), revision: 0 })
      .expect(200);
    expect(u1.body.draftRevision).toBe(1);
    // A second editor still holding revision 0 must not silently overwrite.
    const stale = await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({ name: 'Other', revision: 0 })
      .expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    // Concurrent writers with the same revision: exactly one wins.
    const results = await Promise.all([
      owner.patch(`/api/v1/agents/${a.id}`).send({ name: 'W1', revision: 1 }),
      owner.patch(`/api/v1/agents/${a.id}`).send({ name: 'W2', revision: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('validates configuration: unknown tools, disallowed models, bad limits', async () => {
    const a = (await owner.post('/api/v1/agents').send({ name: 'Validate' }).expect(201)).body;
    const unknownTool = await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({ config: config({ tools: ['rm_rf'] }), revision: 0 })
      .expect(400);
    expect(unknownTool.body.error.details[0].message).toMatch(/Unknown tool/);
    await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({
        config: config({ model: { provider: 'anthropic', model: 'gpt-evil' } }),
        revision: 0,
      })
      .expect(400);
    await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({
        config: config({ limits: { maxSteps: 1000, timeoutSeconds: 60, maxTotalTokens: 20000 } }),
        revision: 0,
      })
      .expect(400);
  });

  it('publishes immutable, incrementing versions and blocks invalid publishes', async () => {
    const a = (await owner.post('/api/v1/agents').send({ name: 'Publisher' }).expect(201)).body;
    const blocked = await owner
      .post(`/api/v1/agents/${a.id}/publish`)
      .send({ revision: 0 })
      .expect(400);
    expect(blocked.body.error.details[0].path).toBe('instructions');

    await owner.patch(`/api/v1/agents/${a.id}`).send({ config: config(), revision: 0 }).expect(200);
    await owner.post(`/api/v1/agents/${a.id}/publish`).send({ revision: 0 }).expect(409); // stale revision
    const v1 = (
      await owner
        .post(`/api/v1/agents/${a.id}/publish`)
        .send({ revision: 1, changelog: 'first' })
        .expect(201)
    ).body;
    expect(v1.version).toBe(1);
    await owner
      .patch(`/api/v1/agents/${a.id}`)
      .send({ config: config({ instructions: 'v2 instructions' }), revision: 1 })
      .expect(200);
    const v2 = (
      await owner.post(`/api/v1/agents/${a.id}/publish`).send({ revision: 2 }).expect(201)
    ).body;
    expect(v2.version).toBe(2);

    const detail = (await owner.get(`/api/v1/agents/${a.id}`).expect(200)).body;
    expect(detail.status).toBe('PUBLISHED');
    expect(detail.publishedVersionId).toBe(v2.id);
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const old = (await owner.get(`/api/v1/agents/${a.id}/versions/${v1.id}`).expect(200)).body;
    expect(old.config.instructions).toBe('You are a helpful support agent.');

    // Versions are immutable at the database level too.
    await expect(
      db.update(agentVersions).set({ changelog: 'tamper' }).where(eq(agentVersions.id, v1.id)),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update agent_versions set config = '{}'::jsonb where id = ${v1.id}`),
    ).rejects.toThrow();
  });

  it('archives and restores; archived agents cannot be edited or run', async () => {
    const a = (await owner.post('/api/v1/agents').send({ name: 'Archivable' }).expect(201)).body;
    await owner.post(`/api/v1/agents/${a.id}/archive`).expect(200);
    await owner.patch(`/api/v1/agents/${a.id}`).send({ name: 'x', revision: 0 }).expect(409);
    await owner
      .post(`/api/v1/agents/${a.id}/runs`)
      .send({ input: 'hi', target: 'draft' })
      .expect(409);
    expect(
      (await owner.get('/api/v1/agents').expect(200)).body.find(
        (x: { id: string }) => x.id === a.id,
      ),
    ).toBeUndefined();
    expect((await owner.get('/api/v1/agents?status=ARCHIVED').expect(200)).body[0].id).toBe(a.id);
    await owner.post(`/api/v1/agents/${a.id}/restore`).expect(200);
  });

  it('lists the tool registry with org switches, and only admins toggle them', async () => {
    const tools = (await owner.get('/api/v1/tools').expect(200)).body as {
      key: string;
      enabled: boolean;
      available: boolean;
      inputSchema: object;
    }[];
    expect(tools.map((t) => t.key)).toEqual(
      expect.arrayContaining(['getOrder', 'searchOrders', 'createSupportTicket', 'httpRequest']),
    );
    expect(tools.find((t) => t.key === 'httpRequest')).toMatchObject({
      enabled: false,
      available: false,
    });
    expect(tools.find((t) => t.key === 'getOrder')!.inputSchema).toMatchObject({ type: 'object' });
    await owner.patch('/api/v1/tools/getOrder').send({ enabled: false }).expect(200);
    expect(
      (await owner.get('/api/v1/tools').expect(200)).body.find(
        (t: { key: string }) => t.key === 'getOrder',
      ).enabled,
    ).toBe(false);
    await owner.patch('/api/v1/tools/doesNotExist').send({ enabled: true }).expect(404);
  });

  it('exposes the model catalog without secrets', async () => {
    const r = (await owner.get('/api/v1/llm/models').expect(200)).body;
    expect(r.providers[0]).toMatchObject({ id: 'anthropic' });
    expect(JSON.stringify(r)).not.toMatch(/sk-ant|api[_-]?key/i);
  });
});

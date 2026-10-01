import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOrg, orgWithMember, registerUser, startApp } from './helpers';

let app: INestApplication;
const redis = new Redis(process.env.REDIS_URL!);
beforeAll(async () => {
  app = await startApp();
});
beforeEach(async () => {
  await redis.flushdb();
});
afterAll(async () => {
  await app.close();
  await redis.quit();
});

describe('organisations', () => {
  it('creator becomes OWNER and the org becomes active', async () => {
    const c = await registerUser(app);
    const orgId = await createOrg(c, 'Acme');
    const me = await c.get('/api/v1/auth/me').expect(200);
    expect(me.body.activeOrganization).toMatchObject({ id: orgId, role: 'OWNER' });
    expect(me.body.permissions).toContain('org:manage');
  });

  it('switches only to organisations the user belongs to', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const orgA1 = await createOrg(a, 'A1');
    const orgA2 = await createOrg(a, 'A2');
    const orgB = await createOrg(b, 'B');
    await a.post('/api/v1/organizations/switch').send({ organizationId: orgA1 }).expect(200);
    expect((await a.get('/api/v1/organizations/current').expect(200)).body.id).toBe(orgA1);
    await a.post('/api/v1/organizations/switch').send({ organizationId: orgB }).expect(404);
    expect((await a.get('/api/v1/organizations/current').expect(200)).body.id).toBe(orgA1);
    expect(orgA2).not.toBe(orgA1);
  });

  it('requires an active organisation for org-scoped routes', async () => {
    const c = await registerUser(app);
    const r = await c.get('/api/v1/agents').expect(403);
    expect(r.body.error.message).toMatch(/organisation/);
  });
});

describe('RBAC', () => {
  it('members can read but not write agents; managers can write but not manage members', async () => {
    const { member, owner } = await orgWithMember(app, 'MEMBER');
    await member.get('/api/v1/agents').expect(200);
    await member.post('/api/v1/agents').send({ name: 'x' }).expect(403);
    await member.get('/api/v1/audit-logs').expect(403);
    await member
      .post('/api/v1/organizations/current/members')
      .send({ email: owner.email, role: 'MEMBER' })
      .expect(403);

    const m = await orgWithMember(app, 'MANAGER');
    await m.member.post('/api/v1/agents').send({ name: 'Mgr agent' }).expect(201);
    await m.member
      .post('/api/v1/organizations/current/members')
      .send({ email: owner.email, role: 'MEMBER' })
      .expect(403);
  });

  it('prevents privilege escalation and protects the last owner', async () => {
    const {
      owner,
      member: admin,
      membershipId: adminMembership,
    } = await orgWithMember(app, 'ADMIN');
    const extra = await registerUser(app);
    // Admin cannot grant OWNER or change their own role.
    await admin
      .post('/api/v1/organizations/current/members')
      .send({ email: extra.email, role: 'OWNER' })
      .expect(400);
    await admin
      .patch(`/api/v1/organizations/current/members/${adminMembership}`)
      .send({ role: 'OWNER' })
      .expect(403);
    const added = await admin
      .post('/api/v1/organizations/current/members')
      .send({ email: extra.email, role: 'MANAGER' })
      .expect(201);
    await admin
      .patch(`/api/v1/organizations/current/members/${added.body.id}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    // Admin cannot touch the owner.
    const members = (await owner.get('/api/v1/organizations/current/members').expect(200)).body as {
      id: string;
      role: string;
    }[];
    const ownerMembership = members.find((m) => m.role === 'OWNER')!.id;
    await admin.delete(`/api/v1/organizations/current/members/${ownerMembership}`).expect(403);
    // Owner cannot remove themselves when they are the last owner.
    await owner.delete(`/api/v1/organizations/current/members/${ownerMembership}`).expect(409);
  });

  it('removing a member revokes access immediately', async () => {
    const { owner, member, membershipId } = await orgWithMember(app, 'MANAGER');
    await member.get('/api/v1/agents').expect(200);
    await owner.delete(`/api/v1/organizations/current/members/${membershipId}`).expect(200);
    await member.get('/api/v1/agents').expect(403);
  });

  it('role downgrades take effect on the next request', async () => {
    const { owner, member, membershipId } = await orgWithMember(app, 'MANAGER');
    await member.post('/api/v1/agents').send({ name: 'ok' }).expect(201);
    await owner
      .patch(`/api/v1/organizations/current/members/${membershipId}`)
      .send({ role: 'MEMBER' })
      .expect(200);
    await member.post('/api/v1/agents').send({ name: 'nope' }).expect(403);
  });
});

describe('tenant isolation (IDOR/BOLA)', () => {
  it('never exposes another organisation’s agents, executions or members', async () => {
    const a = await registerUser(app);
    await createOrg(a, 'A');
    const agentA = (await a.post('/api/v1/agents').send({ name: 'Secret agent' }).expect(201)).body
      .id;

    const b = await registerUser(app);
    await createOrg(b, 'B');
    await b.get(`/api/v1/agents/${agentA}`).expect(404);
    await b.patch(`/api/v1/agents/${agentA}`).send({ name: 'pwned', revision: 0 }).expect(404);
    await b.post(`/api/v1/agents/${agentA}/publish`).send({ revision: 0 }).expect(404);
    await b
      .post(`/api/v1/agents/${agentA}/runs`)
      .send({ input: 'hi', target: 'draft' })
      .expect(404);
    expect(
      (await b.get('/api/v1/agents').expect(200)).body.find((x: { id: string }) => x.id === agentA),
    ).toBeUndefined();
    const members = (await b.get('/api/v1/organizations/current/members').expect(200)).body;
    expect(members).toHaveLength(1);
  });

  it('ignores client-supplied organisation ids in payloads', async () => {
    const a = await registerUser(app);
    const orgA = await createOrg(a, 'A');
    const b = await registerUser(app);
    await createOrg(b, 'B');
    const r = await b
      .post('/api/v1/agents')
      .send({ name: 'mine', organizationId: orgA })
      .expect(201);
    expect(r.body.organizationId).not.toBe(orgA);
  });

  it('rejects malformed ids with 400 rather than querying', async () => {
    const a = await registerUser(app);
    await createOrg(a, 'A');
    await a.get("/api/v1/agents/1' OR '1'='1").expect(400);
  });
});

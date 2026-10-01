import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { createApp } from '../src/bootstrap';

export const ORIGIN = 'http://localhost:3000';

export async function startApp(): Promise<INestApplication> {
  const app = await createApp({ logger: false });
  await app.init();
  return app;
}

export type Client = TestAgent & { userId?: string; email: string; password: string };

/** A cookie-persisting client that always sends the allowed Origin (like the browser). */
export function client(app: INestApplication): Client {
  const agent = request.agent(app.getHttpServer()) as Client;
  agent.set('origin', ORIGIN);
  return agent;
}

export const uniqueEmail = (p = 'user') => `${p}-${randomUUID().slice(0, 8)}@example.com`;
export const PASSWORD = 'correct horse battery 42';

export async function registerUser(app: INestApplication, name = 'Test User'): Promise<Client> {
  const c = client(app);
  c.email = uniqueEmail();
  c.password = PASSWORD;
  await c
    .post('/api/v1/auth/register')
    .send({ name, email: c.email, password: PASSWORD })
    .expect(201);
  const me = await c.get('/api/v1/auth/me').expect(200);
  c.userId = me.body.user.id;
  return c;
}

export async function createOrg(c: Client, name = 'Org'): Promise<string> {
  const r = await c.post('/api/v1/organizations').send({ name }).expect(201);
  return r.body.id as string;
}

/** Owner with an org, plus a second user added with `role`. The member's session is switched to the org. */
export async function orgWithMember(app: INestApplication, role: 'ADMIN' | 'MANAGER' | 'MEMBER') {
  const owner = await registerUser(app, 'Owner');
  const orgId = await createOrg(owner, `Org ${randomUUID().slice(0, 4)}`);
  const member = await registerUser(app, 'Member');
  const m = await owner
    .post('/api/v1/organizations/current/members')
    .send({ email: member.email, role })
    .expect(201);
  await member.post('/api/v1/organizations/switch').send({ organizationId: orgId }).expect(200);
  return { owner, member, orgId, membershipId: m.body.id as string };
}

/** Clears rate-limit counters without touching queue state. */
export async function resetRateLimits(redis: import('ioredis').default) {
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
}

export async function waitFor<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() - start > timeoutMs)
      throw new Error(`waitFor timed out; last value: ${JSON.stringify(v).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB, Database } from '../src/db/db.module';
import { sessions, users } from '../src/db/schema';
import { MailService } from '../src/mail/mail.service';
import { client, ORIGIN, PASSWORD, registerUser, startApp, uniqueEmail } from './helpers';

let app: INestApplication;
let db: Database;
const redis = new Redis(process.env.REDIS_URL!);

beforeAll(async () => {
  app = await startApp();
  db = app.get(DB);
});
beforeEach(async () => {
  await redis.flushdb(); // reset rate-limit counters between tests
});
afterAll(async () => {
  await app.close();
  await redis.quit();
});

describe('registration & login', () => {
  it('registers, sets an httpOnly session cookie and stores an argon2id hash', async () => {
    const email = uniqueEmail();
    const res = await client(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email, password: PASSWORD })
      .expect(201);
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/nexa_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects duplicate emails and weak passwords with structured errors', async () => {
    const c = await registerUser(app);
    const dup = await client(app)
      .post('/api/v1/auth/register')
      .send({ name: 'x', email: c.email.toUpperCase(), password: PASSWORD })
      .expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const weak = await client(app)
      .post('/api/v1/auth/register')
      .send({ name: 'x', email: uniqueEmail(), password: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    expect(weak.body.error.details[0].path).toBe('password');
    expect(weak.body.error).not.toHaveProperty('stack');
  });

  it('logs in with valid credentials and rejects invalid ones generically', async () => {
    const c = await registerUser(app);
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: PASSWORD })
      .expect(200);
    const bad = await client(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'wrong password 1' })
      .expect(401);
    const unknown = await client(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: 'wrong password 1' })
      .expect(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const c = await registerUser(app);
    for (let i = 0; i < 10; i++) {
      await client(app)
        .post('/api/v1/auth/login')
        .send({ email: c.email, password: 'wrong password 1' })
        .expect(401);
    }
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: PASSWORD })
      .expect(429);
  });
});

describe('sessions', () => {
  it('logout invalidates the session server-side', async () => {
    const c = await registerUser(app);
    const cookie = (
      await client(app).post('/api/v1/auth/login').send({ email: c.email, password: PASSWORD })
    ).headers['set-cookie']![0]!.split(';')[0]!;
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('cookie', cookie).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('cookie', cookie)
      .set('origin', ORIGIN)
      .expect(200);
    // Replaying the old cookie must fail even though the browser was told to delete it.
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('cookie', cookie).expect(401);
  });

  it('expires sessions by absolute TTL and idle timeout', async () => {
    const c = await registerUser(app);
    await c.get('/api/v1/auth/me').expect(200);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, c.userId!));
    await c.get('/api/v1/auth/me').expect(401);

    const d = await registerUser(app);
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(sessions.userId, d.userId!));
    await d.get('/api/v1/auth/me').expect(401);
  });

  it('rejects forged or garbage session cookies', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('cookie', 'nexa_session=forged-token-value')
      .expect(401);
  });
});

describe('password reset', () => {
  it('resets once with the emailed token and revokes existing sessions', async () => {
    const c = await registerUser(app);
    const mail = app.get(MailService);
    const spy = vi.spyOn(mail, 'send').mockResolvedValue({ status: 'sent', messageId: 'm1' });
    await client(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: c.email })
      .expect(202);
    // Unknown emails get the identical response (no enumeration) and send nothing.
    await client(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: uniqueEmail() })
      .expect(202);
    expect(spy).toHaveBeenCalledTimes(1);
    const token = new URL(spy.mock.calls[0]![0].text.match(/https?:\/\/\S+/)![0]).searchParams.get(
      'token',
    )!;
    spy.mockRestore();

    const newPassword = 'brand new password 99';
    await client(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: newPassword })
      .expect(200);
    await c.get('/api/v1/auth/me').expect(401); // old session revoked
    const again = await client(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: newPassword })
      .expect(400);
    expect(again.body.error.details[0].path).toBe('token');
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: PASSWORD })
      .expect(401);
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: newPassword })
      .expect(200);
  });

  it('change password keeps the current session and revokes others', async () => {
    const c = await registerUser(app);
    const other = client(app);
    await other.post('/api/v1/auth/login').send({ email: c.email, password: PASSWORD }).expect(200);
    await c
      .post('/api/v1/auth/password')
      .send({ currentPassword: 'nope', newPassword: 'another password 12' })
      .expect(400);
    await c
      .post('/api/v1/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'another password 12' })
      .expect(200);
    await c.get('/api/v1/auth/me').expect(200);
    await other.get('/api/v1/auth/me').expect(401);
  });
});

describe('request hardening', () => {
  it('rate limits login attempts per IP', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (
        await client(app).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'x' })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('blocks cross-origin state-changing requests carrying cookies', async () => {
    const c = await registerUser(app);
    const res = await c
      .post('/api/v1/organizations')
      .set('origin', 'https://evil.example')
      .send({ name: 'x' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects oversized and malformed bodies without leaking internals', async () => {
    const big = await client(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2_000_000) }))
      .expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const bad = await client(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.js|node_modules/);
  });

  it('sets security headers and request ids', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('keeps /metrics hidden without the token', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(404);
  });
});

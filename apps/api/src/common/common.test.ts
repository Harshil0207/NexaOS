import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config';
import { decodeCursor, encodeCursor, page } from './pagination';
import { redact } from './redact';

describe('redact', () => {
  it('masks sensitive keys at any depth and truncates long strings', () => {
    const out = redact({
      a: 1,
      password: 'x',
      nested: { apiKey: 'k', Authorization: 'b', ok: 'y' },
      list: [{ token: 't' }],
      long: 'z'.repeat(5000),
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.nested).toEqual({ apiKey: '[redacted]', Authorization: '[redacted]', ok: 'y' });
    expect(out.list).toEqual([{ token: '[redacted]' }]);
    expect((out.long as string).endsWith('[truncated]')).toBe(true);
  });
  it('keeps token counts but hides token values', () => {
    expect(
      redact({
        maxTotalTokens: 5,
        inputTokens: 1,
        accessToken: 'a',
        refresh_token: 'b',
        sessionToken: 'c',
        password_hash: 'x',
      }),
    ).toEqual({
      maxTotalTokens: 5,
      inputTokens: 1,
      accessToken: '[redacted]',
      refresh_token: '[redacted]',
      sessionToken: '[redacted]',
      password_hash: '[redacted]',
    });
  });
});

describe('pagination', () => {
  it('round-trips cursors and rejects tampered ones', () => {
    const c = {
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: '6f1d3b9e-3c2a-4b8e-9f1a-2b3c4d5e6f70',
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(() => decodeCursor('garbage')).toThrow();
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify(['2026-01-01', "1' OR 1=1"])).toString('base64url')),
    ).toThrow();
  });
  it('pages with limit+1 lookahead', () => {
    const rows = [1, 2, 3].map((i) => ({
      id: `00000000-0000-0000-0000-00000000000${i}`,
      createdAt: new Date(i),
    }));
    const p = page(rows, 2);
    expect(p.items).toHaveLength(2);
    expect(p.nextCursor).not.toBeNull();
    expect(page(rows, 5).nextCursor).toBeNull();
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgresql://a@b/c',
    REDIS_URL: 'redis://r',
    SESSION_SECRET: 'x'.repeat(32),
  };
  it('validates required settings', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
  it('requires WEB_ORIGIN in production and defaults secure cookies', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/WEB_ORIGIN/);
    const c = loadConfig({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
    });
    expect(c.cookieSecure).toBe(true);
    expect(loadConfig(base).cookieSecure).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, issuesToErrors } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('parses structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'VALIDATION_FAILED',
                message: 'Bad',
                requestId: 'r1',
                details: [{ path: 'config.limits.maxSteps', message: 'Too big' }],
              },
            }),
            { status: 400 },
          ),
      ),
    );
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'r1' });
    expect(err.fieldErrors()).toEqual({ maxSteps: 'Too big' });
  });
  it('maps network failures and non-JSON 5xx responses to friendly errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })),
    );
    await expect(api('/x')).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'The server had a problem completing this request.',
    });
  });
  it('sends JSON bodies as POST with same-origin credentials', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api('/auth/login', { body: { a: 1 } });
    expect(f).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' }),
    );
  });
  it('keeps the first validation issue per field', () => {
    expect(
      issuesToErrors([
        { path: ['password'], message: 'first' },
        { path: ['password'], message: 'second' },
      ]),
    ).toEqual({ password: 'first' });
  });
});

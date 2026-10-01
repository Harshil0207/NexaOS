import { describe, expect, it, vi } from 'vitest';
import { LlmError } from './llm.types';
import { withRetry } from './retry';

const noSleep = vi.fn(async () => undefined);

describe('withRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ < 2) throw new LlmError('PROVIDER_UNAVAILABLE', 'x', true);
        return 'ok';
      },
      { maxRetries: 3, sleep: noSleep },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(async () => {
      throw new LlmError('PROVIDER_REQUEST_REJECTED', 'no', false);
    });
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_REJECTED',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and honours Retry-After', async () => {
    const delays: number[] = [];
    const fn = vi.fn(async () => {
      throw new LlmError('PROVIDER_RATE_LIMITED', 'slow', true, 1234);
    });
    await expect(
      withRetry(fn, { maxRetries: 2, sleep: noSleep, onRetry: (_e, _a, d) => delays.push(d) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1234, 1234]);
  });

  it('does not retry plain errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('bug');
    });
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep })).rejects.toThrow('bug');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

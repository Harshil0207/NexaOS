import { LlmError } from './llm.types';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (err: LlmError, attempt: number, delayMs: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Retries only errors flagged retryable, with exponential backoff + full jitter, honouring Retry-After. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8_000;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (
        !(err instanceof LlmError) ||
        !err.retryable ||
        attempt >= opts.maxRetries ||
        opts.signal?.aborted
      ) {
        throw err;
      }
      const backoff = Math.min(max, base * 2 ** attempt);
      const delay = Math.min(max, err.retryAfterMs ?? Math.floor(Math.random() * backoff) + 100);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay, opts.signal);
    }
  }
}

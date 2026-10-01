import type { ApiErrorBody, ApiErrorCode } from '@nexa/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    public readonly details?: { path: string; message: string }[],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field → message map for form display. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) out[d.path.split('.').at(-1) ?? d.path] ??= d.message;
    return out;
  }
}

type Json = Record<string, unknown> | unknown[];

export async function api<T>(
  path: string,
  init: { method?: string; body?: Json; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const e = (body as ApiErrorBody | null)?.error;
    const fallback =
      res.status >= 500
        ? 'The server had a problem completing this request.'
        : `Request failed (${res.status})`;
    throw new ApiError(
      res.status,
      e?.code ?? (res.status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
      e?.message ?? fallback,
      e?.details,
      e?.requestId,
    );
  }
  return body as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : 'Something went wrong';

/** First validation message per top-level field (Zod issues → form errors). */
export function issuesToErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}

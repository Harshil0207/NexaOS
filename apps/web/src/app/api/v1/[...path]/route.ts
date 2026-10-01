import type { NextRequest } from 'next/server';

/**
 * Same-origin streaming proxy to the API. Keeps session cookies first-party, streams
 * Server-Sent Events without buffering, and forwards only an allowlist of headers.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const REQUEST_HEADERS = [
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'last-event-id',
  'x-request-id',
  'accept',
  'x-forwarded-for',
];
const RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'x-request-id',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-accel-buffering',
];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((seg) => seg === '..' || seg.includes('/')))
    return new Response(null, { status: 400 });
  const url = `${API}/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error duplex is required by undici for streaming request bodies
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: req.signal,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        error: { code: 'DEPENDENCY_FAILED', message: 'The API is unreachable. Try again shortly.' },
      },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const h of RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };

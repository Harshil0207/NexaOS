import { z } from 'zod';
import { assertSafeOutboundUrl } from '../ssrf';
import { defineTool, ToolError } from '../tool.types';

const MAX_BYTES = 100_000;
const MAX_REDIRECTS = 3;

export const httpRequestTool = defineTool({
  key: 'httpRequest',
  name: 'HTTP GET (allowlisted)',
  description:
    'Fetch a JSON or text resource with HTTP GET from an administrator-allowlisted host. Returns status and up to 100KB of body.',
  kind: 'READ',
  permission: 'records:read',
  idempotent: true,
  defaultEnabled: false,
  risk: 'medium',
  input: z.object({ url: z.string().max(2000) }),
  output: z.object({
    status: z.number(),
    contentType: z.string().nullable(),
    body: z.string(),
    truncated: z.boolean(),
  }),
  availability: (config) =>
    config.HTTP_TOOL_ALLOWED_HOSTS.length
      ? { available: true }
      : { available: false, reason: 'HTTP_TOOL_ALLOWED_HOSTS is not configured' },
  async execute(input, ctx) {
    const policy = {
      allowedHosts: ctx.deps.config.HTTP_TOOL_ALLOWED_HOSTS,
      allowHttp: !ctx.deps.config.isProd,
    };
    let url = await assertSafeOutboundUrl(input.url, policy);
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctx.signal,
        headers: {
          accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
          'user-agent': 'NexaOS-Agent/1.0',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= MAX_REDIRECTS) throw new ToolError('TOO_MANY_REDIRECTS', 'Too many redirects');
        // Every redirect target is re-validated against the allowlist and IP rules.
        url = await assertSafeOutboundUrl(
          new URL(res.headers.get('location')!, url).toString(),
          policy,
        );
        continue;
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          chunks.push(value.subarray(0, value.byteLength - (size - MAX_BYTES)));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (res.status >= 500)
        throw new ToolError('UPSTREAM_ERROR', `Upstream returned ${res.status}`, true);
      return { status: res.status, contentType: res.headers.get('content-type'), body, truncated };
    }
  },
});

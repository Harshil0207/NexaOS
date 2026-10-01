import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.provider';
import { LlmError, LlmRequest } from './llm.types';

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: 'claude-haiku-4-5',
  system: 'sys',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  tools: [{ name: 'getOrder', description: 'd', inputSchema: { type: 'object' } }],
  maxOutputTokens: 100,
  temperature: 0,
  ...over,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const provider = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
  new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://api.example', timeoutMs, fetchImpl });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e instanceof LlmError
      ? { code: e.code, retryable: e.retryable, retryAfterMs: e.retryAfterMs }
      : { other: e };
  }
  return null;
}

describe('AnthropicProvider', () => {
  it('reports not configured without an API key and never calls the network', async () => {
    const f = vi.fn();
    const p = new AnthropicProvider({
      baseUrl: 'https://x',
      timeoutMs: 1000,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(p.isConfigured()).toBe(false);
    expect(await codeOf(p.complete(req()))).toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('sends a well-formed request and parses text + tool_use', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.tools[0]).toEqual({
        name: 'getOrder',
        description: 'd',
        input_schema: { type: 'object' },
      });
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
      return json(200, {
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Checking' },
          { type: 'tool_use', id: 'tu_1', name: 'getOrder', input: { orderNumber: '1234' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
      });
    });
    const r = await provider(f as unknown as typeof fetch).complete(req());
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(r.content[1]).toEqual({
      type: 'tool_use',
      id: 'tu_1',
      name: 'getOrder',
      input: { orderNumber: '1234' },
    });
  });

  it.each([
    [
      429,
      { error: { type: 'rate_limit_error', message: 'slow' } },
      { 'retry-after': '3' },
      'PROVIDER_RATE_LIMITED',
      true,
    ],
    [
      529,
      { error: { type: 'overloaded_error', message: 'busy' } },
      {},
      'PROVIDER_UNAVAILABLE',
      true,
    ],
    [500, { error: { type: 'api_error', message: 'boom' } }, {}, 'PROVIDER_UNAVAILABLE', true],
    [
      400,
      { error: { type: 'invalid_request_error', message: 'prompt is too long: 300000 tokens' } },
      {},
      'CONTEXT_LIMIT_EXCEEDED',
      false,
    ],
    [
      401,
      { error: { type: 'authentication_error', message: 'bad key' } },
      {},
      'PROVIDER_REQUEST_REJECTED',
      false,
    ],
  ])('maps HTTP %i to %s', async (status, body, headers, code, retryable) => {
    const f = vi.fn(async () => json(status, body, headers));
    const r = await codeOf(provider(f as unknown as typeof fetch).complete(req()));
    expect(r).toMatchObject({ code, retryable });
    if (status === 429) expect(r?.retryAfterMs).toBe(3000);
  });

  it('rejects malformed (non-JSON and wrong-shape) responses', async () => {
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(
      await codeOf(provider(notJson as unknown as typeof fetch).complete(req())),
    ).toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    const wrong = vi.fn(async () => json(200, { hello: 'world' }));
    expect(await codeOf(provider(wrong as unknown as typeof fetch).complete(req()))).toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
      retryable: false,
    });
  });

  it('times out a hung request', async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, rej) =>
          init.signal!.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
    );
    expect(await codeOf(provider(f as unknown as typeof fetch, 50).complete(req()))).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });

  it('classifies network failures as unavailable', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await codeOf(provider(f as unknown as typeof fetch).complete(req()))).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('propagates caller cancellation instead of reporting a timeout', async () => {
    const ctrl = new AbortController();
    const reason = new Error('cancelled');
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, rej) =>
          init.signal!.addEventListener('abort', () => rej(new Error('x'))),
        ),
    );
    const p = provider(f as unknown as typeof fetch).complete(req({ signal: ctrl.signal }));
    ctrl.abort(reason);
    await expect(p).rejects.toBe(reason);
  });

  const sse = (events: object[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          for (const e of events) c.enqueue(enc.encode(`event: x\ndata: ${JSON.stringify(e)}\n\n`));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  it('streams text deltas and assembles tool calls from partial JSON', async () => {
    const f = vi.fn(async () =>
      sse([
        {
          type: 'message_start',
          message: { model: 'm', usage: { input_tokens: 7, output_tokens: 1 } },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 't1', name: 'getOrder' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"orderNu' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'mber":"1234"}' },
        },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ]),
    );
    const deltas: string[] = [];
    const r = await provider(f as unknown as typeof fetch).complete(
      req({ onTextDelta: (d) => deltas.push(d) }),
    );
    expect(deltas.join('')).toBe('Hello');
    expect(r.content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 't1', name: 'getOrder', input: { orderNumber: '1234' } },
    ]);
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });

  it('flags malformed streamed tool JSON and truncated streams', async () => {
    const bad = vi.fn(async () =>
      sse([
        {
          type: 'message_start',
          message: { model: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 't1', name: 'getOrder' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"orderNumber":' },
        },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]),
    );
    const r = await provider(bad as unknown as typeof fetch).complete(
      req({ onTextDelta: () => undefined }),
    );
    expect(r.content[0]).toMatchObject({ type: 'tool_use', input: { __malformed: true } });

    const cut = vi.fn(async () => sse([{ type: 'message_start', message: { model: 'm' } }]));
    expect(
      await codeOf(
        provider(cut as unknown as typeof fetch).complete(req({ onTextDelta: () => undefined })),
      ),
    ).toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
    });
  });

  it('maps in-stream errors', async () => {
    const f = vi.fn(async () =>
      sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]),
    );
    expect(
      await codeOf(
        provider(f as unknown as typeof fetch).complete(req({ onTextDelta: () => undefined })),
      ),
    ).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });
});

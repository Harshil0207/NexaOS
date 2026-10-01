import { z } from 'zod';
import {
  LlmContentBlock,
  LlmError,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmTextBlock,
  LlmToolUseBlock,
  StopReason,
} from './llm.types';

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const API_VERSION = '2023-06-01';

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
});

const responseSchema = z.object({
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
      }),
      z.object({ type: z.literal('thinking') }).loose(),
      z.object({ type: z.literal('redacted_thinking') }).loose(),
    ]),
  ),
  usage: usageSchema,
});

function mapStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

function toWire(messages: LlmMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b: LlmContentBlock) => {
      switch (b.type) {
        case 'text':
          return { type: 'text', text: b.text };
        case 'tool_use':
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: b.toolUseId,
            content: b.content,
            is_error: b.isError,
          };
      }
    }),
  }));
}

/** Anthropic Messages API adapter (raw HTTP so errors and timeouts are fully under our control). */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: AnthropicOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return !!this.opts.apiKey;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.opts.apiKey) {
      throw new LlmError('PROVIDER_NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured', false);
    }
    const stream = !!req.onTextDelta;
    const body = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature,
      system: req.system || undefined,
      messages: toWire(req.messages),
      tools: req.tools.length
        ? req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          }))
        : undefined,
      stream,
    };

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.opts.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout.signal]) : timeout.signal;
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw this.networkError(err, timeout.signal, req.signal);
    }

    try {
      if (!res.ok) throw await this.httpError(res);
      const parsed = stream
        ? await this.readStream(res, req.onTextDelta!)
        : await this.readJson(res);
      return { ...parsed, latencyMs: Date.now() - started };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw this.networkError(err, timeout.signal, req.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private networkError(
    err: unknown,
    timeoutSignal: AbortSignal,
    callerSignal?: AbortSignal,
  ): Error {
    if (callerSignal?.aborted) {
      // Propagate caller cancellation untouched so the runtime can tell cancel/deadline apart.
      return callerSignal.reason instanceof Error ? callerSignal.reason : new Error('aborted');
    }
    if (timeoutSignal.aborted)
      return new LlmError('PROVIDER_TIMEOUT', 'Model request timed out', true);
    const msg = err instanceof Error ? err.message : 'network error';
    return new LlmError('PROVIDER_UNAVAILABLE', `Could not reach model provider: ${msg}`, true);
  }

  private async httpError(res: Response): Promise<LlmError> {
    let message = `Provider returned HTTP ${res.status}`;
    let type = '';
    try {
      const j = (await res.json()) as { error?: { type?: string; message?: string } };
      type = j.error?.type ?? '';
      if (j.error?.message) message = j.error.message.slice(0, 500);
    } catch {
      /* body not JSON */
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    if (res.status === 429)
      return new LlmError('PROVIDER_RATE_LIMITED', message, true, retryAfterMs, 429);
    if (res.status === 529 || res.status >= 500) {
      return new LlmError('PROVIDER_UNAVAILABLE', message, true, retryAfterMs, res.status);
    }
    if (res.status === 408) return new LlmError('PROVIDER_TIMEOUT', message, true, undefined, 408);
    if (
      res.status === 413 ||
      /prompt is too long|context.{0,20}(window|length)|too many tokens/i.test(message)
    ) {
      return new LlmError('CONTEXT_LIMIT_EXCEEDED', message, false, undefined, res.status);
    }
    const hint =
      res.status === 401 || res.status === 403 ? ' (check API key)' : type ? ` (${type})` : '';
    return new LlmError(
      'PROVIDER_REQUEST_REJECTED',
      `${message}${hint}`,
      false,
      undefined,
      res.status,
    );
  }

  private async readJson(res: Response): Promise<Omit<LlmResponse, 'latencyMs'>> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LlmError('PROVIDER_INVALID_RESPONSE', 'Provider returned a non-JSON body', true);
    }
    const r = responseSchema.safeParse(json);
    if (!r.success) {
      throw new LlmError(
        'PROVIDER_INVALID_RESPONSE',
        'Provider response did not match the expected shape',
        false,
      );
    }
    const content = r.data.content.filter(
      (b): b is LlmTextBlock | LlmToolUseBlock => b.type === 'text' || b.type === 'tool_use',
    ) as (LlmTextBlock | LlmToolUseBlock)[];
    return {
      content,
      stopReason: mapStop(r.data.stop_reason),
      usage: this.usage(r.data.usage),
      model: r.data.model,
    };
  }

  private usage(u: z.infer<typeof usageSchema>) {
    return {
      inputTokens:
        u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    };
  }

  /** Parses the Messages API SSE stream into a final response while emitting text deltas. */
  private async readStream(
    res: Response,
    onDelta: (d: string) => void,
  ): Promise<Omit<LlmResponse, 'latencyMs'>> {
    if (!res.body) throw new LlmError('PROVIDER_INVALID_RESPONSE', 'Empty stream body', true);
    const blocks: (
      { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; json: string }
    )[] = [];
    let model = '';
    let stop: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let finished = false;

    const decoder = new TextDecoder();
    let buffer = '';
    const reader = res.body.getReader();
    const handle = (data: string) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new LlmError('PROVIDER_INVALID_RESPONSE', 'Malformed stream event', true);
      }
      switch (ev.type) {
        case 'message_start': {
          const m = ev.message as { model?: string; usage?: z.input<typeof usageSchema> };
          model = m?.model ?? model;
          if (m?.usage) {
            const u = this.usage(usageSchema.parse(m.usage));
            inputTokens = u.inputTokens;
            outputTokens = u.outputTokens;
          }
          break;
        }
        case 'content_block_start': {
          const b = ev.content_block as { type: string; id?: string; name?: string; text?: string };
          const i = ev.index as number;
          if (b.type === 'text') blocks[i] = { type: 'text', text: b.text ?? '' };
          else if (b.type === 'tool_use')
            blocks[i] = { type: 'tool_use', id: b.id ?? '', name: b.name ?? '', json: '' };
          break;
        }
        case 'content_block_delta': {
          const d = ev.delta as { type: string; text?: string; partial_json?: string };
          const blk = blocks[ev.index as number];
          if (d.type === 'text_delta' && blk?.type === 'text' && d.text) {
            blk.text += d.text;
            onDelta(d.text);
          } else if (d.type === 'input_json_delta' && blk?.type === 'tool_use') {
            blk.json += d.partial_json ?? '';
          }
          break;
        }
        case 'message_delta': {
          const d = ev.delta as { stop_reason?: string | null };
          const u = ev.usage as { output_tokens?: number } | undefined;
          if (d?.stop_reason !== undefined) stop = d.stop_reason;
          if (typeof u?.output_tokens === 'number') outputTokens = u.output_tokens;
          break;
        }
        case 'message_stop':
          finished = true;
          break;
        case 'error': {
          const e = ev.error as { type?: string; message?: string };
          const overloaded = e?.type === 'overloaded_error' || e?.type === 'api_error';
          throw new LlmError(
            e?.type === 'rate_limit_error'
              ? 'PROVIDER_RATE_LIMITED'
              : overloaded
                ? 'PROVIDER_UNAVAILABLE'
                : 'PROVIDER_REQUEST_REJECTED',
            e?.message?.slice(0, 500) ?? 'Provider stream error',
            overloaded || e?.type === 'rate_limit_error',
          );
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data) handle(data);
      }
    }
    if (!finished)
      throw new LlmError('PROVIDER_INVALID_RESPONSE', 'Stream ended before completion', true);

    const content: (LlmTextBlock | LlmToolUseBlock)[] = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'text') content.push({ type: 'text', text: b.text });
      else {
        let input: unknown;
        try {
          input = b.json ? JSON.parse(b.json) : {};
        } catch {
          // Surface as a malformed tool call; the runtime reports it to the model as invalid input.
          input = { __malformed: true };
        }
        content.push({ type: 'tool_use', id: b.id, name: b.name, input });
      }
    }
    return { content, stopReason: mapStop(stop), usage: { inputTokens, outputTokens }, model };
  }
}

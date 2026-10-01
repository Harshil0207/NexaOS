import {
  LlmError,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolUseBlock,
} from '../src/llm/llm.types';

/** Test double for the provider interface. Only used by automated tests. */
export type Script = (req: LlmRequest, call: number) => Promise<LlmResponse> | LlmResponse;

export class FakeLlmProvider implements LlmProvider {
  readonly displayName = 'Fake';
  calls: LlmRequest[] = [];
  constructor(
    public script: Script,
    readonly id = 'fake',
  ) {}
  isConfigured() {
    return true;
  }
  async complete(req: LlmRequest) {
    this.calls.push(structuredClone({ ...req, signal: undefined, onTextDelta: undefined }));
    return this.script(req, this.calls.length - 1);
  }
}

export const text = (t: string, usage = { inputTokens: 100, outputTokens: 20 }): LlmResponse => ({
  content: [{ type: 'text', text: t }],
  stopReason: 'end_turn',
  usage,
  model: 'fake-model',
  latencyMs: 5,
});

export const toolUse = (
  calls: Omit<LlmToolUseBlock, 'type'>[],
  usage = { inputTokens: 100, outputTokens: 20 },
): LlmResponse => ({
  content: calls.map((c) => ({ type: 'tool_use' as const, ...c })),
  stopReason: 'tool_use',
  usage,
  model: 'fake-model',
  latencyMs: 5,
});

export const fail = (code: LlmError['code'], retryable = false) => {
  throw new LlmError(code, `fake ${code}`, retryable);
};

/** Resolves only when the request is aborted (simulates a hung provider). */
export const hang = (req: LlmRequest) =>
  new Promise<LlmResponse>((_, reject) => {
    req.signal?.addEventListener('abort', () => reject(req.signal!.reason), { once: true });
  });

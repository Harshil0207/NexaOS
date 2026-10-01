import type { ExecutionErrorCode } from '@nexa/shared';

export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input object. */
  inputSchema: Record<string, unknown>;
}

export type LlmTextBlock = { type: 'text'; text: string };
export type LlmToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type LlmToolResultBlock = {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
};
export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
  /** When provided the provider streams and reports text deltas as they arrive. */
  onTextDelta?: (delta: string) => void;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface LlmResponse {
  content: (LlmTextBlock | LlmToolUseBlock)[];
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode = Extract<
  ExecutionErrorCode,
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_REQUEST_REJECTED'
  | 'CONTEXT_LIMIT_EXCEEDED'
>;

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

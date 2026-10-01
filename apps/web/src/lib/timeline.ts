import type { ExecutionStatus } from '@nexa/shared';
import type { TimelineEvent } from './types';

export interface StreamState {
  events: TimelineEvent[];
  lastSeq: number;
  status: ExecutionStatus | null;
  /** Live model text per step, streamed before the step's llm.response lands. */
  live: Record<number, string>;
  ended: boolean;
}

export const initialStream: StreamState = {
  events: [],
  lastSeq: 0,
  status: null,
  live: {},
  ended: false,
};

export type StreamAction =
  | { type: 'event'; event: TimelineEvent }
  | { type: 'delta'; step: number; text: string }
  | { type: 'end'; status: ExecutionStatus }
  | { type: 'reset' };

/** Pure reducer: events are applied strictly in seq order and duplicates (reconnect replays) are ignored. */
export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'reset':
      return initialStream;
    case 'event': {
      const e = action.event;
      if (e.seq <= state.lastSeq) return state;
      const live = { ...state.live };
      const step = typeof e.payload.step === 'number' ? e.payload.step : null;
      if (
        step !== null &&
        (e.type === 'llm.response' || e.type === 'llm.retry' || e.type === 'llm.error')
      )
        delete live[step];
      const status = (e.status ??
        (e.payload.status as ExecutionStatus | undefined) ??
        state.status) as ExecutionStatus | null;
      return { ...state, events: [...state.events, e], lastSeq: e.seq, status, live };
    }
    case 'delta':
      if (state.ended) return state;
      return {
        ...state,
        live: { ...state.live, [action.step]: (state.live[action.step] ?? '') + action.text },
      };
    case 'end':
      return { ...state, status: action.status, ended: true, live: {} };
  }
}

export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral' | 'info';

export function describeEvent(e: TimelineEvent): { title: string; detail?: string; tone: Tone } {
  const p = e.payload as Record<string, unknown>;
  const tool = typeof p.tool === 'string' ? p.tool : '';
  switch (e.type) {
    case 'execution.queued':
      return {
        title: 'Queued',
        detail: p.retryOf
          ? 'Retry of a previous run'
          : String(p.trigger ?? '')
              .replace('_', ' ')
              .toLowerCase(),
        tone: 'neutral',
      };
    case 'execution.started':
      return { title: 'Agent started', detail: `${p.provider}/${p.model}`, tone: 'accent' };
    case 'execution.resumed':
      return {
        title: 'Resumed after worker restart',
        detail: `from step ${p.step}`,
        tone: 'warning',
      };
    case 'execution.cancel_requested':
      return { title: 'Cancellation requested', tone: 'warning' };
    case 'llm.request':
      return {
        title: `Model call · step ${p.step}`,
        detail: String(p.model ?? ''),
        tone: 'neutral',
      };
    case 'llm.retry':
      return {
        title: `Model call retried (attempt ${p.attempt})`,
        detail: `${p.code}: ${p.message}`,
        tone: 'warning',
      };
    case 'llm.response': {
      const calls = Array.isArray(p.toolCalls) ? (p.toolCalls as string[]) : [];
      return {
        title: calls.length ? `Model requested ${calls.join(', ')}` : 'Model responded',
        detail: `${p.inputTokens} in · ${p.outputTokens} out · ${p.stopReason}`,
        tone: 'info',
      };
    }
    case 'llm.error':
      return { title: 'Model call failed', detail: `${p.code}: ${p.message}`, tone: 'danger' };
    case 'tool.requested':
      return { title: `Tool requested · ${tool}`, tone: 'neutral' };
    case 'tool.started':
      return {
        title: `Tool running · ${tool}`,
        detail: String(p.kind ?? '').toLowerCase(),
        tone: 'accent',
      };
    case 'tool.succeeded':
      return { title: `Tool result · ${tool}`, tone: 'success' };
    case 'tool.denied':
      return {
        title: `Tool call blocked · ${tool}`,
        detail: `${p.code}: ${p.message}`,
        tone: 'warning',
      };
    case 'tool.invalid':
      return {
        title: `Invalid tool call · ${tool}`,
        detail: `${p.code}: ${p.message}`,
        tone: 'warning',
      };
    case 'tool.failed':
      return { title: `Tool failed · ${tool}`, detail: `${p.code}: ${p.message}`, tone: 'danger' };
    case 'execution.completed':
      return {
        title: 'Completed',
        detail: p.truncated ? 'Output truncated at max tokens' : undefined,
        tone: 'success',
      };
    case 'execution.failed':
      return { title: 'Failed', detail: `${p.code}: ${p.message}`, tone: 'danger' };
    case 'execution.cancelled':
      return { title: 'Cancelled', tone: 'neutral' };
    case 'execution.timed_out':
      return { title: 'Timed out', detail: String(p.message ?? ''), tone: 'warning' };
    default:
      return { title: e.type, tone: 'neutral' };
  }
}

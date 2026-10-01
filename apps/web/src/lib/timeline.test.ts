import { describe, expect, it } from 'vitest';
import { describeEvent, initialStream, streamReducer } from './timeline';

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}, status?: string) => ({
  type: 'event' as const,
  event: { seq, type, payload, createdAt: new Date(0).toISOString(), status: status as never },
});

describe('streamReducer', () => {
  it('ignores duplicate and out-of-order events replayed after a reconnect', () => {
    let s = streamReducer(initialStream, ev(1, 'execution.started', {}, 'RUNNING'));
    s = streamReducer(s, ev(2, 'llm.request', { step: 1 }));
    s = streamReducer(s, ev(1, 'execution.started'));
    s = streamReducer(s, ev(2, 'llm.request', { step: 1 }));
    s = streamReducer(s, ev(3, 'llm.response', { step: 1 }));
    expect(s.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(s.status).toBe('RUNNING');
  });

  it('accumulates streamed text and clears it when the step response lands', () => {
    let s = streamReducer(initialStream, { type: 'delta', step: 1, text: 'Hel' });
    s = streamReducer(s, { type: 'delta', step: 1, text: 'lo' });
    expect(s.live[1]).toBe('Hello');
    s = streamReducer(s, ev(4, 'llm.response', { step: 1 }));
    expect(s.live[1]).toBeUndefined();
  });

  it('clears partial text when a model call is retried', () => {
    let s = streamReducer(initialStream, { type: 'delta', step: 2, text: 'partial' });
    s = streamReducer(s, ev(1, 'llm.retry', { step: 2, attempt: 1 }));
    expect(s.live).toEqual({});
  });

  it('marks the end state and stops accepting deltas', () => {
    let s = streamReducer(initialStream, { type: 'end', status: 'FAILED' });
    s = streamReducer(s, { type: 'delta', step: 1, text: 'late' });
    expect(s).toMatchObject({ ended: true, status: 'FAILED', live: {} });
  });
});

describe('describeEvent', () => {
  it('describes denied tool calls as warnings with their code', () => {
    const d = describeEvent({
      seq: 1,
      type: 'tool.denied',
      payload: { tool: 'createSupportTicket', code: 'PERMISSION_DENIED', message: 'nope' },
      createdAt: '',
    });
    expect(d).toMatchObject({ tone: 'warning', title: 'Tool call blocked · createSupportTicket' });
    expect(d.detail).toContain('PERMISSION_DENIED');
  });
  it('never labels a failure as success', () => {
    expect(
      describeEvent({
        seq: 1,
        type: 'execution.failed',
        payload: { code: 'PROVIDER_TIMEOUT', message: 'x' },
        createdAt: '',
      }).tone,
    ).toBe('danger');
  });
});

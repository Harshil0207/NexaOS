'use client';
import type { ExecutionStatus } from '@nexa/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';
import { initialStream, streamReducer } from '@/lib/timeline';
import type { TimelineEvent } from '@/lib/types';

/**
 * Live execution timeline over SSE. The server replays persisted events after Last-Event-ID
 * (EventSource sends it automatically on reconnect) and the reducer drops duplicates by seq.
 */
export function useExecutionStream(executionId: string | null) {
  const [state, dispatch] = useReducer(streamReducer, initialStream);
  const [connection, setConnection] = useState<'connecting' | 'open' | 'reconnecting' | 'closed'>(
    'connecting',
  );
  const qc = useQueryClient();

  useEffect(() => {
    dispatch({ type: 'reset' });
    if (!executionId) return;
    setConnection('connecting');
    const es = new EventSource(`/api/v1/executions/${executionId}/stream`);
    es.onopen = () => setConnection('open');
    es.addEventListener('event', (m) => {
      const e = JSON.parse((m as MessageEvent).data) as TimelineEvent;
      dispatch({ type: 'event', event: e });
      if (
        e.type.startsWith('tool.') ||
        e.type.startsWith('execution.') ||
        e.type === 'llm.response'
      ) {
        void qc.invalidateQueries({ queryKey: ['execution', executionId] });
      }
    });
    es.addEventListener('delta', (m) => {
      const d = JSON.parse((m as MessageEvent).data) as { step: number; text: string };
      dispatch({ type: 'delta', step: d.step, text: d.text });
    });
    es.addEventListener('end', (m) => {
      const d = JSON.parse((m as MessageEvent).data) as { status: ExecutionStatus };
      dispatch({ type: 'end', status: d.status });
      setConnection('closed');
      es.close();
      void qc.invalidateQueries({ queryKey: ['execution', executionId] });
      void qc.invalidateQueries({ queryKey: ['executions'] });
    });
    es.onerror = () => setConnection((c) => (c === 'closed' ? c : 'reconnecting'));
    return () => es.close();
  }, [executionId, qc]);

  return { ...state, connection };
}

'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

/**
 * Organisation-wide execution feed. Keeps lists and dashboard current without manual
 * refresh. EventSource reconnects on its own; after a reconnect we refetch to cover gaps.
 * Each tab holds its own connection, so multiple tabs stay independently consistent.
 */
export function useOrgStream(enabled: boolean): StreamState {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/v1/stream');
    let hadError = false;
    const flush = () => {
      timer.current = null;
      void qc.invalidateQueries({ queryKey: ['executions'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['usage'] });
    };
    const schedule = () => {
      if (!timer.current) timer.current = setTimeout(flush, 400);
    };
    es.addEventListener('ready', () => {
      setState('live');
      if (hadError) schedule();
      hadError = false;
    });
    es.addEventListener('execution', (e) => {
      const id = (e as MessageEvent).lastEventId;
      if (id && seen.current.has(id)) return; // de-duplicate after reconnects
      if (id) {
        seen.current.add(id);
        if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
      }
      schedule();
    });
    es.onerror = () => {
      hadError = true;
      setState('reconnecting');
    };
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, qc]);

  return state;
}

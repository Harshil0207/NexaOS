'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Page } from '@/lib/types';

/** Keyset-paginated list backed by the API's opaque cursors. */
export function useCursorList<T>(
  key: unknown[],
  path: string,
  params: Record<string, string | undefined>,
) {
  const qs = (cursor?: string) =>
    new URLSearchParams(
      Object.entries({ ...params, cursor }).filter((e): e is [string, string] => !!e[1]),
    ).toString();
  const q = useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam, signal }) => api<Page<T>>(`${path}?${qs(pageParam)}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items) };
}

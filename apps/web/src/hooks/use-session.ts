'use client';
import type { Permission } from '@nexa/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: 60_000 });
}

/** UI-level permission check. Only hides affordances; the API enforces every permission. */
export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (p: Permission) => set.has(p);
}

'use client';
import { createOrganizationSchema } from '@nexa/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';

export default function OnboardingPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = createOrganizationSchema.safeParse({
      name: new FormData(e.currentTarget).get('name'),
    });
    if (!parsed.success) return setError('Enter an organisation name (up to 100 characters)');
    setPending(true);
    setError(null);
    try {
      await api('/organizations', { body: parsed.data });
      window.location.assign('/dashboard');
    } catch (err) {
      setPending(false);
      setError(err instanceof ApiError ? err.message : 'Could not create the organisation');
    }
  };

  const existing = me.data?.organizations ?? [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-8">
      <Logo />
      <div className="flex flex-1 flex-col justify-center py-12">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Step 1 of 1</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Create your organisation</h1>
        <p className="mt-1.5 text-sm text-muted">
          Organisations own agents, data and audit history. You’ll be its owner and can invite
          teammates afterwards.
        </p>
        <form onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
          <Field label="Organisation name" htmlFor="name" error={error ?? undefined}>
            <Input
              id="name"
              name="name"
              placeholder="Acme Retail"
              autoFocus
              required
              aria-invalid={!!error}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={pending}>
            Create organisation <ArrowRight aria-hidden />
          </Button>
        </form>
        {existing.length > 0 && (
          <div className="mt-10">
            <h2 className="text-[13px] font-medium text-muted">
              Or continue with an existing organisation
            </h2>
            <ul className="mt-2 grid gap-2">
              {existing.map((o) => (
                <li key={o.id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                    onClick={async () => {
                      await api('/organizations/switch', { body: { organizationId: o.id } });
                      window.location.assign('/dashboard');
                    }}
                  >
                    <Building2 className="size-4 text-faint" aria-hidden />
                    <span className="flex-1 truncate">{o.name}</span>
                    <span className="text-xs text-faint">{o.role.toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link
          href="/login"
          className="mt-10 text-[13px] text-muted hover:text-fg"
          onClick={() => void api('/auth/logout', { method: 'POST' }).catch(() => undefined)}
        >
          Sign in with a different account
        </Link>
      </div>
    </main>
  );
}

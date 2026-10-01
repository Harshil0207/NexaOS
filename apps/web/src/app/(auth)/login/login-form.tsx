'use client';
import { loginSchema } from '@nexa/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { AuthHeading, FormError } from '../auth-form';

/** Only allow same-origin relative redirects (prevents open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/dashboard';
}

export function LoginForm() {
  const params = useSearchParams();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(
    params.get('expired') ? 'Your session ended. Please sign in again.' : null,
  );
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({ email: fd.get('email'), password: fd.get('password') });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            i.path[0] === 'email' ? 'Enter a valid email address' : 'Enter your password',
          ]),
        ),
      );
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await api('/auth/login', { body: parsed.data });
      window.location.assign(safeNext(params.get('next')));
    } catch (err) {
      setPending(false);
      setFormError(err instanceof ApiError ? err.message : 'Sign in failed');
    }
  };

  return (
    <>
      <AuthHeading title="Sign in" subtitle="Welcome back to your workforce." />
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormError message={formError} />
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
        </Field>
        <div className="-mt-1 text-right">
          <Link href="/forgot-password" className="text-[13px] text-muted hover:text-fg">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        New to NexaOS?{' '}
        <Link href="/register" className="font-medium text-fg underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

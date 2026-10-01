'use client';
import { password as passwordSchema } from '@nexa/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { AuthHeading, FormError } from '../auth-form';

export function ResetForm() {
  const token = useSearchParams().get('token');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <>
        <AuthHeading
          title="Link is incomplete"
          subtitle="Open the reset link from your email again, or request a new one."
        />
        <Link
          href="/forgot-password"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          Request a new link
        </Link>
      </>
    );
  }
  if (done) {
    return (
      <div role="status">
        <AuthHeading
          title="Password updated"
          subtitle="All other sessions were signed out. Sign in with your new password."
        />
        <Button asChild variant="primary">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password') ?? '');
    const parsed = passwordSchema.safeParse(pw);
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message);
    if (pw !== fd.get('confirm')) return setFieldError('Passwords do not match');
    setFieldError(undefined);
    setPending(true);
    try {
      await api('/auth/password-reset/confirm', { body: { token, password: pw } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors().token ?? err.message) : 'Reset failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormError message={error} />
        <Field
          label="New password"
          htmlFor="password"
          error={fieldError}
          hint="At least 12 characters, with letters and numbers."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            aria-invalid={!!fieldError}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Update password
        </Button>
      </form>
    </>
  );
}

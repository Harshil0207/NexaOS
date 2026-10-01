'use client';
import { registerSchema } from '@nexa/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError, issuesToErrors } from '@/lib/api';
import { AuthHeading, FormError } from '../auth-form';

export default function RegisterPage() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = registerSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await api('/auth/register', { body: parsed.data });
      window.location.assign('/onboarding');
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.details) setErrors(err.fieldErrors());
      setFormError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  };

  const invalid = (k: string) => ({
    'aria-invalid': !!errors[k],
    'aria-describedby': errors[k] ? `${k}-error` : `${k}-hint`,
  });
  return (
    <>
      <AuthHeading title="Create your account" subtitle="You’ll set up an organisation next." />
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormError message={formError} />
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            autoFocus
            {...invalid('name')}
          />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            {...invalid('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint="At least 12 characters, with letters and numbers."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            {...invalid('password')}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

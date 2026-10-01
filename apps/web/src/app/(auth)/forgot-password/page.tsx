'use client';
import { requestPasswordResetSchema } from '@nexa/shared';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { AuthHeading, FormError } from '../auth-form';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = requestPasswordResetSchema.safeParse({
      email: new FormData(e.currentTarget).get('email'),
    });
    if (!parsed.success) return setError('Enter a valid email address');
    setPending(true);
    setError(null);
    try {
      await api('/auth/password-reset/request', { body: parsed.data });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <div role="status">
        <MailCheck className="mb-4 size-8 text-accent" aria-hidden />
        <AuthHeading
          title="Check your inbox"
          subtitle="If an account exists for that email, a reset link is on its way. It expires in 60 minutes."
        />
        <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <>
      <AuthHeading
        title="Reset your password"
        subtitle="We’ll email you a link to choose a new one."
      />
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormError message={error} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

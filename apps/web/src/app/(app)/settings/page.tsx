'use client';
import { changePasswordSchema, createOrganizationSchema, updateProfileSchema } from '@nexa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CopyId } from '@/components/ui/copy';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { useCan, useMe } from '@/hooks/use-session';
import { api, ApiError, errorMessage, issuesToErrors } from '@/lib/api';

export default function SettingsPage() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});

  const profile = useMutation({
    mutationFn: (name: string) => api('/auth/profile', { method: 'PATCH', body: { name } }),
    onSuccess: () => {
      toast.success('Profile updated');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const password = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api('/auth/password', { body }),
    onSuccess: () => {
      toast.success('Password changed. Other sessions were signed out.');
      setPwErrors({});
    },
    onError: (e) =>
      setPwErrors(
        e instanceof ApiError ? { ...e.fieldErrors(), form: e.message } : { form: errorMessage(e) },
      ),
  });
  const org = useMutation({
    mutationFn: (name: string) =>
      api('/organizations/current', { method: 'PATCH', body: { name } }),
    onSuccess: () => {
      toast.success('Organisation renamed');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!me.data) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your profile, security and organisation." />
      <div className="grid max-w-3xl gap-6">
        <Panel>
          <PanelHeader title="Profile" />
          <form
            className="grid gap-4 px-5 py-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const p = updateProfileSchema.safeParse({
                name: new FormData(e.currentTarget).get('name'),
              });
              if (!p.success) return toast.error('Enter a name up to 100 characters');
              profile.mutate(p.data.name);
            }}
          >
            <Field label="Name" htmlFor="p-name">
              <Input id="p-name" name="name" defaultValue={me.data.user.name} />
            </Field>
            <Field label="Email" htmlFor="p-email" hint="Email changes are not supported yet.">
              <Input id="p-email" value={me.data.user.email} disabled />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={profile.isPending}>
                Save profile
              </Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <PanelHeader
            title="Password"
            description="Changing your password signs out every other session."
          />
          <form
            className="grid gap-4 px-5 py-5 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const p = changePasswordSchema.safeParse({
                currentPassword: fd.get('currentPassword'),
                newPassword: fd.get('newPassword'),
              });
              if (!p.success) return setPwErrors(issuesToErrors(p.error.issues));
              password.mutate(p.data, { onSuccess: () => e.currentTarget?.reset() });
            }}
          >
            {pwErrors.form && (
              <p role="alert" className="text-[13px] text-danger sm:col-span-2">
                {pwErrors.form}
              </p>
            )}
            <Field
              label="Current password"
              htmlFor="currentPassword"
              error={pwErrors.currentPassword}
            >
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!pwErrors.currentPassword}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="newPassword"
              error={pwErrors.newPassword}
              hint="At least 12 characters, with letters and numbers."
            >
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!pwErrors.newPassword}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={password.isPending}>
                Change password
              </Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="Appearance" />
          <div className="px-5 py-5">
            <Field label="Theme" htmlFor="theme" className="max-w-xs">
              <Select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="system">Match system</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Organisation"
            description={
              can('org:manage')
                ? 'Only owners can rename the organisation.'
                : 'Read-only: only owners can change organisation settings.'
            }
          />
          <form
            className="grid gap-4 px-5 py-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const p = createOrganizationSchema.safeParse({
                name: new FormData(e.currentTarget).get('name'),
              });
              if (!p.success) return toast.error('Enter a name up to 100 characters');
              org.mutate(p.data.name);
            }}
          >
            <Field label="Name" htmlFor="o-name">
              <Input
                id="o-name"
                name="name"
                defaultValue={me.data.activeOrganization?.name}
                disabled={!can('org:manage')}
              />
            </Field>
            <Field label="Organisation ID" htmlFor="o-id">
              <div
                id="o-id"
                className="flex h-9 items-center rounded-[var(--radius-control)] border bg-surface-2 px-3"
              >
                <CopyId value={me.data.activeOrganization!.id} />
              </div>
            </Field>
            {can('org:manage') && (
              <div className="sm:col-span-2">
                <Button type="submit" loading={org.isPending}>
                  Rename organisation
                </Button>
              </div>
            )}
          </form>
        </Panel>
      </div>
    </>
  );
}

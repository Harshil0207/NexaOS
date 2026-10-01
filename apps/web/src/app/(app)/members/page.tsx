'use client';
import { addMemberSchema, ROLE_RANK, ROLES, permissionsForRole, type Role } from '@nexa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { Badge } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useCan, useMe } from '@/hooks/use-session';
import { api, ApiError, errorMessage, issuesToErrors } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import type { Member } from '@/lib/types';

const ROLE_BLURB: Record<Role, string> = {
  OWNER: 'Everything, including organisation settings and ownership.',
  ADMIN: 'Manage members below admin, tools and the audit log.',
  MANAGER: 'Build, publish and operate agents; view usage.',
  MEMBER: 'Run published agents and view results.',
};

export default function MembersPage() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const myRole = me.data?.activeOrganization?.role ?? 'MEMBER';
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/organizations/current/members'),
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const grantable = ROLES.filter((r) => myRole === 'OWNER' || ROLE_RANK[r] < ROLE_RANK[myRole]);

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api(`/organizations/current/members/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => {
      toast.success('Role updated');
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/organizations/current/members/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      setRemoving(null);
      if (members.data?.find((m) => m.id === id)?.userId === me.data?.user.id)
        window.location.assign('/onboarding');
      else {
        toast.success('Member removed');
        void qc.invalidateQueries({ queryKey: ['members'] });
      }
    },
    onError: (e) => {
      setRemoving(null);
      toast.error(errorMessage(e));
    },
  });
  const canManage = (m: Member) =>
    can('members:manage') &&
    m.userId !== me.data?.user.id &&
    (myRole === 'OWNER' || ROLE_RANK[m.role] < ROLE_RANK[myRole]);

  return (
    <>
      <PageHeader
        title="Members"
        description="People in this organisation and their roles. Permission changes take effect on their next request."
        actions={
          can('members:manage') && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden /> Add member
            </Button>
          )
        }
      />
      <Panel>
        {members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : !members.data ? (
          <SkeletonRows />
        ) : members.data.length === 0 ? (
          <EmptyState icon={<Users />} title="No members" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Member</TH>
                <TH>Role</TH>
                <TH className="hidden sm:table-cell">Joined</TH>
                <TH className="sr-only">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {members.data.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="font-medium">
                      {m.name}
                      {m.userId === me.data?.user.id && (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted">{m.email}</div>
                  </TD>
                  <TD>
                    {canManage(m) ? (
                      <Select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        className="h-8 w-32"
                        onChange={(e) =>
                          changeRole.mutate({ id: m.id, role: e.target.value as Role })
                        }
                      >
                        {ROLES.filter((r) => grantable.includes(r) || r === m.role).map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0) + r.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'OWNER' ? 'accent' : 'neutral'}>
                        {m.role.toLowerCase()}
                      </Badge>
                    )}
                  </TD>
                  <TD className="hidden text-xs text-muted sm:table-cell">
                    {fmtRelative(m.createdAt)}
                  </TD>
                  <TD className="text-right">
                    {(canManage(m) || m.userId === me.data?.user.id) && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                        {m.userId === me.data?.user.id ? 'Leave' : 'Remove'}
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title="Roles & permissions"
          description="Roles map to explicit permissions; the API checks permissions, never role names."
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="bg-surface px-5 py-4">
              <div className="text-sm font-semibold">{r.charAt(0) + r.slice(1).toLowerCase()}</div>
              <p className="mt-1 text-[13px] text-muted">{ROLE_BLURB[r]}</p>
              <ul className="mt-3 flex flex-wrap gap-1">
                {permissionsForRole(r).map((p) => (
                  <li
                    key={p}
                    className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <AddMemberDialog open={adding} onOpenChange={setAdding} roles={grantable} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={
          removing?.userId === me.data?.user.id
            ? 'Leave this organisation?'
            : `Remove ${removing?.name}?`
        }
        description="They lose access immediately. Their past actions stay in the audit log."
        confirmLabel={removing?.userId === me.data?.user.id ? 'Leave' : 'Remove'}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: Role[];
}) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (body: { email: string; role: Role }) =>
      api('/organizations/current/members', { body }),
    onSuccess: () => {
      toast.success('Member added');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError ? { ...e.fieldErrors(), form: e.message } : { form: errorMessage(e) },
      ),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add member"
      description="The person must already have a NexaOS account. Email invitations arrive in a later release."
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const p = addMemberSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
          if (!p.success) return setErrors(issuesToErrors(p.error.issues));
          setErrors({});
          add.mutate(p.data);
        }}
      >
        {errors.form && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.form}
          </p>
        )}
        <Field label="Email" htmlFor="m-email" error={errors.email}>
          <Input id="m-email" name="email" type="email" autoFocus aria-invalid={!!errors.email} />
        </Field>
        <Field label="Role" htmlFor="m-role" error={errors.role}>
          <Select
            id="m-role"
            name="role"
            defaultValue={roles.includes('MEMBER') ? 'MEMBER' : roles[0]}
          >
            {roles
              .filter((r) => r !== 'OWNER')
              .map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()} — {ROLE_BLURB[r]}
                </option>
              ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add member
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

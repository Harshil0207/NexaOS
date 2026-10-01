import {
  agentConfigSchema,
  ROLES,
  roleHasPermission,
  type AgentConfig,
  type Permission,
  type Role,
} from '@nexa/shared';

export interface DraftState {
  name: string;
  description: string;
  config: AgentConfig;
}

export function isDirty(a: DraftState, b: DraftState): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Client-side mirror of server validation for immediate feedback (the server stays authoritative). */
export function validateDraft(d: DraftState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.name.trim()) errors.name = 'Name is required';
  if (d.name.length > 80) errors.name = 'Keep the name under 80 characters';
  const r = agentConfigSchema.safeParse(d.config);
  if (!r.success) for (const i of r.error.issues) errors[i.path.join('.')] ??= i.message;
  return errors;
}

export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((r) => roleHasPermission(r, permission));
}

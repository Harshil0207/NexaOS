/**
 * Permission catalog. Roles map to explicit permissions; code must check
 * permissions, never role names, so new roles can be added without touching call sites.
 */
export const PERMISSIONS = [
  'org:read',
  'org:manage',
  'members:read',
  'members:manage',
  'agents:read',
  'agents:write',
  'agents:publish',
  'agents:execute',
  'executions:read',
  'executions:cancel',
  'executions:retry',
  'tools:read',
  'tools:manage',
  'records:read',
  'records:write',
  'audit:read',
  'usage:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

const MEMBER: Permission[] = [
  'org:read',
  'members:read',
  'agents:read',
  'agents:execute',
  'executions:read',
  'tools:read',
  'records:read',
];
const MANAGER: Permission[] = [
  ...MEMBER,
  'agents:write',
  'agents:publish',
  'executions:cancel',
  'executions:retry',
  'records:write',
  'usage:read',
];
const ADMIN: Permission[] = [...MANAGER, 'members:manage', 'tools:manage', 'audit:read'];
const OWNER: Permission[] = [...ADMIN, 'org:manage'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  MANAGER: new Set(MANAGER),
  MEMBER: new Set(MEMBER),
};

/** Rank used to stop users granting/removing roles above their own. */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  OWNER: 4,
  ADMIN: 3,
  MANAGER: 2,
  MEMBER: 1,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

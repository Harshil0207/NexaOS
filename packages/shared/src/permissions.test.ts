import { describe, expect, it } from 'vitest';
import { ROLES, roleHasPermission, ROLE_PERMISSIONS } from './permissions';
import { canTransition, sourcesFor, TERMINAL_STATUSES, EXECUTION_TRANSITIONS } from './execution';

describe('role permissions', () => {
  it('is monotonic: each higher role is a superset of the lower one', () => {
    const order = ['MEMBER', 'MANAGER', 'ADMIN', 'OWNER'] as const;
    for (let i = 1; i < order.length; i++) {
      for (const p of ROLE_PERMISSIONS[order[i - 1]!]) {
        expect(ROLE_PERMISSIONS[order[i]!].has(p)).toBe(true);
      }
    }
    expect(ROLES).toHaveLength(4);
  });
  it('restricts sensitive permissions', () => {
    expect(roleHasPermission('MEMBER', 'agents:write')).toBe(false);
    expect(roleHasPermission('MANAGER', 'members:manage')).toBe(false);
    expect(roleHasPermission('ADMIN', 'org:manage')).toBe(false);
    expect(roleHasPermission('OWNER', 'org:manage')).toBe(true);
  });
});

describe('execution state machine', () => {
  it('has no transitions out of terminal states', () => {
    for (const s of TERMINAL_STATUSES) expect(EXECUTION_TRANSITIONS[s]).toEqual([]);
  });
  it('allows only legal transitions', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
  });
  it('computes source states for atomic updates', () => {
    expect(sourcesFor('CANCELLED').sort()).toEqual(
      ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_TOOL'].sort(),
    );
  });
});

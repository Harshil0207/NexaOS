import { describe, expect, it } from 'vitest';
import { isDirty, rolesWith, validateDraft, type DraftState } from './agent-draft';

const base: DraftState = {
  name: 'Support',
  description: '',
  config: {
    instructions: 'Help',
    model: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
    tools: ['getOrder'],
    limits: { maxSteps: 8, timeoutSeconds: 120, maxTotalTokens: 50000 },
  },
};

describe('agent draft helpers', () => {
  it('detects changes deeply', () => {
    expect(isDirty(base, structuredClone(base))).toBe(false);
    expect(isDirty(base, { ...base, config: { ...base.config, tools: [] } })).toBe(true);
  });
  it('validates limits and names', () => {
    expect(validateDraft(base)).toEqual({});
    const bad = validateDraft({
      ...base,
      name: ' ',
      config: { ...base.config, limits: { ...base.config.limits, maxSteps: 100 } },
    });
    expect(bad.name).toBeDefined();
    expect(bad['limits.maxSteps']).toBeDefined();
  });
  it('maps permissions to roles', () => {
    expect(rolesWith('records:write')).toEqual(['OWNER', 'ADMIN', 'MANAGER']);
    expect(rolesWith('records:read')).toContain('MEMBER');
  });
});

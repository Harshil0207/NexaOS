import { describe, expect, it } from 'vitest';
import { registerSchema, addMemberSchema, updateAgentSchema, createOrderSchema } from './index';

describe('schemas', () => {
  it('normalises email and enforces password strength', () => {
    const ok = registerSchema.parse({
      name: 'Ada',
      email: ' ADA@Example.com ',
      password: 'correct horse 42',
    });
    expect(ok.email).toBe('ada@example.com');
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'short1' }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'onlyletterslong' })
        .success,
    ).toBe(false);
  });
  it('rejects control characters in names', () => {
    expect(
      registerSchema.safeParse({ name: 'A\u0000', email: 'a@b.co', password: 'abcdefghij12' })
        .success,
    ).toBe(false);
  });
  it('cannot invite an OWNER', () => {
    expect(addMemberSchema.safeParse({ email: 'a@b.co', role: 'OWNER' }).success).toBe(false);
    expect(addMemberSchema.safeParse({ email: 'a@b.co', role: 'ADMIN' }).success).toBe(true);
  });
  it('rejects bad tool keys and limits', () => {
    const base = {
      revision: 0,
      config: {
        instructions: '',
        model: { provider: 'anthropic', model: 'm' },
        tools: ['../etc'],
        limits: { maxSteps: 5, timeoutSeconds: 60, maxTotalTokens: 5000 },
      },
    };
    expect(updateAgentSchema.safeParse(base).success).toBe(false);
    expect(
      updateAgentSchema.safeParse({
        ...base,
        config: {
          ...base.config,
          tools: ['getOrder'],
          limits: { maxSteps: 999, timeoutSeconds: 60, maxTotalTokens: 5000 },
        },
      }).success,
    ).toBe(false);
  });
  it('validates order numbers', () => {
    const c = '6f1d3b9e-3c2a-4b8e-9f1a-2b3c4d5e6f70';
    expect(
      createOrderSchema.safeParse({ orderNumber: '1234', customerId: c, totalCents: 100 }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({ orderNumber: "1'; DROP", customerId: c, totalCents: 100 })
        .success,
    ).toBe(false);
  });
});

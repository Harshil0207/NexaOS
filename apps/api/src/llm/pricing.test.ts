import { describe, expect, it } from 'vitest';
import { PricingTable } from './pricing';

describe('PricingTable', () => {
  it('resolves dated model ids by family prefix', () => {
    const p = new PricingTable();
    expect(p.costMicros('claude-haiku-4-5-20251001', 1_000_000, 0)).toBe(1_000_000);
    expect(p.costMicros('claude-haiku-4-5', 1000, 1000)).toBe(1000 * 1 + 1000 * 5);
  });
  it('returns null for unknown models rather than guessing', () => {
    expect(new PricingTable().costMicros('mystery-model', 10, 10)).toBeNull();
  });
  it('accepts overrides and validates them', () => {
    const p = new PricingTable('{"my-model":{"inputPerMTok":2,"outputPerMTok":4}}');
    expect(p.costMicros('my-model', 10, 10)).toBe(60);
    expect(() => new PricingTable('{"x":{"inputPerMTok":"a"}}')).toThrow();
  });
});

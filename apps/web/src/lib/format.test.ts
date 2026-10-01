import { describe, expect, it } from 'vitest';
import { fmtCost, fmtDuration, fmtPercent } from './format';

describe('formatters', () => {
  it('keeps precision for small costs', () => {
    expect(fmtCost(0)).toBe('$0.00');
    expect(fmtCost(3100)).toBe('$0.0031');
    expect(fmtCost(1_234_567)).toBe('$1.23');
  });
  it('formats durations', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(142)).toBe('142 ms');
    expect(fmtDuration(2500)).toBe('2.50 s');
    expect(fmtDuration(125_000)).toBe('2m 5s');
  });
  it('formats rates', () => {
    expect(fmtPercent(null)).toBe('—');
    expect(fmtPercent(1)).toBe('100%');
    expect(fmtPercent(0.875)).toBe('87.5%');
  });
});

import { describe, expect, it } from 'vitest';
import { safeNext } from './login-form';

describe('safeNext (open-redirect protection)', () => {
  it.each([
    ['/agents', '/agents'],
    [null, '/dashboard'],
    ['https://evil.com', '/dashboard'],
    ['//evil.com', '/dashboard'],
    ['/\\evil.com', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});

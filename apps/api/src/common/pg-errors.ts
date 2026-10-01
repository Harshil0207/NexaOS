/** True when an error is a Postgres unique-constraint violation (optionally for a named constraint). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = findPgError(err);
  return !!e && e.code === '23505' && (!constraint || e.constraint === constraint);
}

function findPgError(err: unknown): { code?: string; constraint?: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const c = cur as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof c.code === 'string') return { code: c.code, constraint: c.constraint };
    cur = c.cause;
  }
  return null;
}

/**
 * Redacts values whose keys look sensitive before data is persisted to events/audit logs
 * or returned to clients. Also bounds size so large tool payloads cannot bloat storage.
 */
// Matches secret-bearing keys (password, apiKey, accessToken, ...) but not metrics such as
// inputTokens or maxTotalTokens: "token" only counts when it ends the key.
const SENSITIVE =
  /(passw(or)?d|secret|token$|api[-_]?key|authorization|cookie|credential|^ssn$|card[-_]?number|^cvv$|^iban$|private[-_]?key)/i;
const MAX_STRING = 4_000;
const MAX_DEPTH = 8;
const MAX_KEYS = 100;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

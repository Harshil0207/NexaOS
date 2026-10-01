export const fmtNumber = (n: number) => new Intl.NumberFormat('en-US').format(n);

export const fmtCompact = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Micro-dollars → "$0.0123". Small amounts keep precision so per-run costs stay meaningful. */
export function fmtCost(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function durationBetween(a: string | null, b: string | null): number | null {
  if (!a) return null;
  return (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export const fmtPercent = (x: number | null) =>
  x == null ? '—' : `${(x * 100).toFixed(x >= 0.995 || x === 0 ? 0 : 1)}%`;

export const shortId = (id: string) => id.slice(0, 8);

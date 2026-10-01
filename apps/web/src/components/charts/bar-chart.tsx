'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface BarSeries {
  key: string;
  label: string;
  /** CSS colour (token var). */
  color: string;
  /** Diagonal texture as a secondary, non-colour cue (e.g. for failures). */
  textured?: boolean;
}

interface Props<T extends { label: string }> {
  data: T[];
  series: BarSeries[];
  value: (row: T, key: string) => number;
  format?: (n: number) => string;
  height?: number;
  title: string;
  className?: string;
}

/**
 * Stacked bar chart in plain SVG: thin bars, 4px rounded data-end, 2px surface gaps
 * between segments, recessive grid, per-bar hover tooltip, legend, and an accessible
 * table fallback for screen readers.
 */
export function StackedBarChart<T extends { label: string }>({
  data,
  series,
  value,
  format = String,
  height = 160,
  title,
  className,
}: Props<T>) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  // Draw in real pixels so axis text stays legible at every width.
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([entry]) => entry && setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const totals = data.map((d) => series.reduce((a, s) => a + value(d, s.key), 0));
  const max = Math.max(1, ...totals);
  const niceMax = niceCeil(max);
  const W = width;
  const H = height;
  const padB = 18;
  const plotH = H - padB - 6;
  const slot = W / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, slot * 0.56));
  const y = (v: number) => (v / niceMax) * plotH;

  return (
    <figure ref={ref} className={cn('relative', className)}>
      <div
        className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
        aria-hidden
      >
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" className="rounded-[2px]">
              <rect
                width="10"
                height="10"
                fill={s.textured ? `url(#tex-${id})` : s.color}
                style={{ color: s.color }}
              />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={title}
      >
        <defs>
          <pattern
            id={`tex-${id}`}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="currentColor" opacity="0.35" />
            <rect width="2" height="5" fill="currentColor" />
          </pattern>
        </defs>
        {[0, 0.5, 1]
          .filter((t) => t !== 0.5 || format(niceMax * 0.5) !== format(niceMax))
          .map((t) => (
            <g key={t}>
              <line
                x1="0"
                x2={W}
                y1={6 + plotH - t * plotH}
                y2={6 + plotH - t * plotH}
                stroke="var(--border)"
                strokeWidth="1"
              />
              {t > 0 && (
                <text
                  x="0"
                  y={6 + plotH - t * plotH - 4}
                  fontSize="10"
                  fill="var(--faint)"
                  className="tabular"
                >
                  {format(niceMax * t)}
                </text>
              )}
            </g>
          ))}
        {data.map((d, i) => {
          const x = i * slot + (slot - barW) / 2;
          let acc = 0;
          const segs = series.map((s) => ({ s, v: value(d, s.key) })).filter((x) => x.v > 0);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {segs.map(({ s, v }, j) => {
                const h = Math.max(1.5, y(v));
                const top = 6 + plotH - acc - h;
                acc += h + (j < segs.length - 1 ? 2 : 0);
                const isTop = j === segs.length - 1;
                return (
                  <path
                    key={s.key}
                    d={roundedTop(x, top, barW, h, isTop ? Math.min(4, barW / 2, h) : 0)}
                    fill={s.textured ? `url(#tex-${id})` : s.color}
                    style={{ color: s.color }}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                    className="transition-opacity duration-150"
                  />
                );
              })}
              {(i === data.length - 1 ||
                i % Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(W / 70)))) ===
                  0) && (
                <text
                  x={i * slot + slot / 2}
                  y={H - 2}
                  fontSize="10"
                  textAnchor="middle"
                  fill="var(--faint)"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 z-10 min-w-36 -translate-x-1/2 rounded-md border border-border-strong bg-surface/95 px-2.5 py-2 text-xs shadow-panel backdrop-blur"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
        >
          <div className="mb-1 font-medium text-fg">{data[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4 text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-mono text-fg tabular">
                {format(value(data[hover]!, s.key))}
              </span>
            </div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              {series.map((s) => (
                <td key={s.key}>{format(value(d, s.key))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function niceCeil(n: number) {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

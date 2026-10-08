/**
 * Small, dependency-free SVG charts that follow the organisation's colours. Each one carries a text alternative for screen readers.
 * They are server components (no scripts) so they cost nothing to load.
 */
const fmt = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(Math.round(n)));

export function ColumnChart({ data, label, series, money, unit = '' }: { data: { label: string; a: number; b?: number }[]; label: string; series: [string, string?]; money?: boolean; unit?: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b ?? 0]));
  const W = 320, H = 150, pad = 22, bw = data.length ? (W - pad * 2) / data.length : 20;
  const two = data.some((d) => d.b != null);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.a}${two ? ` and ${d.b ?? 0}` : ''}`).join(', ')}`}>
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={pad} x2={W - pad / 2} y1={H - t * (H - 14)} y2={H - t * (H - 14)} stroke="currentColor" opacity="0.1" />)}
        {data.map((d, i) => {
          const x = pad + i * bw, h1 = (d.a / max) * (H - 14), h2 = ((d.b ?? 0) / max) * (H - 14), w = two ? bw * 0.34 : bw * 0.56;
          return (
            <g key={d.label}>
              <rect x={x + bw * (two ? 0.12 : 0.22)} y={H - h1} width={w} height={Math.max(h1, 1)} rx="3" style={{ fill: 'rgb(var(--accent))' }} />
              {two && <rect x={x + bw * 0.52} y={H - h2} width={w} height={Math.max(h2, 1)} rx="3" style={{ fill: 'rgb(var(--brand-2))' }} />}
              {d.a > 0 && <text x={x + bw * (two ? 0.12 : 0.22) + w / 2} y={H - h1 - 3} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.7">{money ? fmt(d.a) : d.a}{unit}</text>}
              <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.65">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted"><span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--accent))' }} />{series[0]}</span>{series[1] && <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--brand-2))' }} />{series[1]}</span>}</figcaption>
    </figure>
  );
}

export function HBars({ data, label, money }: { data: { label: string; value: number; sub?: string }[]; label: string; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2" aria-label={label}>
      {data.map((d, i) => (
        <li key={d.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate">{d.label}</span><span className="shrink-0 font-semibold tabular-nums">{money ? fmt(d.value) : d.value}{d.sub ? <span className="ml-1 text-xs font-normal text-muted">{d.sub}</span> : null}</span></div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: i % 2 ? 'rgb(var(--brand-2))' : 'rgb(var(--accent))' }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Gauge({ value, label, sub }: { value: number | null; label: string; sub?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 42, c = 2 * Math.PI * r;
  const tone = value == null ? 'rgb(148 163 184)' : v >= 75 ? '#16a34a' : v >= 60 ? 'rgb(var(--accent))' : v >= 40 ? '#f59e0b' : '#dc2626';
  return (
    <div className="flex items-center gap-4" role="img" aria-label={`${label}: ${value == null ? 'no data yet' : Math.round(v) + ' out of 100'}`}>
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90"><circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" opacity="0.12" strokeWidth="10" /><circle cx="50" cy="50" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} /></svg>
      <div><p className="text-3xl font-bold tabular-nums">{value == null ? '–' : Math.round(v)}<span className="text-base font-medium text-muted">/100</span></p>{sub && <p className="text-sm text-muted">{sub}</p>}</div>
    </div>
  );
}

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <p className="text-xs text-muted">The trend appears after two months of results.</p>;
  const W = 140, H = 36, step = W / Math.max(1, values.length - 1);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${(p.i * step).toFixed(1)} ${(H - (p.v / 100) * (H - 4) - 2).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-36" role="img" aria-label={`${label}: ${pts.map((p) => Math.round(p.v)).join(', ')}`}><path d={d} fill="none" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Donut({ parts, label }: { parts: { label: string; value: number; color?: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 38, C = 2 * Math.PI * r;
  const colors = ['rgb(var(--accent))', 'rgb(var(--brand-2))', '#64748b', '#16a34a', '#f59e0b', '#0ea5e9'];
  let off = 0;
  return (
    <div className="flex items-center gap-4" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" opacity="0.1" strokeWidth="14" />
        {total > 0 && parts.map((p, i) => { const len = (p.value / total) * C; const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={p.color ?? colors[i % colors.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />; off += len; return el; })}
      </svg>
      <ul className="space-y-1 text-sm">{parts.map((p, i) => <li key={p.label} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color ?? colors[i % colors.length] }} />{p.label} <strong className="tabular-nums">{p.value}</strong></li>)}</ul>
    </div>
  );
}

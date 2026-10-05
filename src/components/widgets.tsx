import Link from 'next/link';
import type { WidgetResult } from '@/server/dashboards';

export function WidgetGrid({ results, big = false }: { results: WidgetResult[]; big?: boolean }) {
  return (
    <div className={`grid gap-3 ${big ? 'grid-cols-2 gap-6 xl:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      {results.map((r) => {
        const w = r.widget;
        if (w.type === 'text') return <div key={w.id} className={`card ${big ? 'col-span-full !bg-white/5 !text-white' : 'sm:col-span-2'}`}>{w.title && <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{w.title}</p>}<p className={`whitespace-pre-wrap ${big ? 'text-3xl' : 'text-sm'}`}>{r.value}</p></div>;
        if (w.type === 'entity_list') return (
          <div key={w.id} className={`card ${big ? '!bg-white/5 !text-white' : ''}`}><p className="text-xs font-semibold uppercase tracking-wide opacity-60">{w.title}</p>
            <ul className={`mt-2 divide-y ${big ? 'divide-white/10 text-xl' : 'divide-line text-sm'}`}>{(r.rows ?? []).length === 0 ? <li className="py-2 opacity-60">Nothing yet</li> : r.rows!.map((x, i) => <li key={i} className="py-1.5">{x.href && !big ? <Link href={x.href} className="underline">{x.title}</Link> : x.title}{x.sub && <span className="ml-2 opacity-60">{x.sub}</span>}</li>)}</ul></div>);
        return (
          <div key={w.id} className={`card ${big ? '!bg-white/5 !text-white' : ''}`}><p className="text-xs font-semibold uppercase tracking-wide opacity-60">{w.title}</p>
            <p className={`mt-1 font-bold tabular-nums ${big ? 'text-7xl' : 'text-3xl'}`}>{r.value}</p>{r.sub && <p className={`opacity-60 ${big ? 'text-lg' : 'text-xs'}`}>{r.sub}</p>}</div>);
      })}
    </div>
  );
}

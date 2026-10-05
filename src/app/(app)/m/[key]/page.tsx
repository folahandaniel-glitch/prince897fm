import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { listRecords } from '@/server/builders';
import { showValue } from '@/components/dyn-fields';
import { Empty, PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ModuleList({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ q?: string; status?: string }> }) {
  const { key } = await params; const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('builders');
    const d = await listRecords(p.ctx, key, { q: sp.q, status: sp.status });
    if (!d) notFound();
    const { entity: e, rows, canCreate } = d;
    const cols = e.fields.filter((f) => !f.archived).slice(0, 4);
    const label = (s: string) => e.statuses.find((x) => x.key === s)?.label ?? s;
    return (
      <div className="space-y-4">
        <PageHead title={e.plural} sub={e.description}>{canCreate && <Link className="btn-primary" href={`/m/${key}/new`}>New {e.name.toLowerCase()}</Link>}{p.allowed('builder:manage') && <><Link className="btn-ghost" href={`/builder/${key}`}>Edit module</Link><a className="btn-ghost" href={`/api/module-export/${key}`}>Export CSV</a></>}</PageHead>
        <form className="flex flex-wrap items-end gap-2" role="search"><div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" /></div><div><label className="label" htmlFor="s">Status</label><select id="s" name="status" defaultValue={sp.status ?? ''} className="input"><option value="">Any</option>{e.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div><button className="btn-ghost">Filter</button></form>
        {rows.length === 0 ? <Empty title={`No ${e.plural.toLowerCase()} yet`} text={canCreate ? 'Create the first one.' : 'Nothing has been recorded.'} href={canCreate ? `/m/${key}/new` : undefined} action={canCreate ? `New ${e.name.toLowerCase()}` : undefined} /> : (
          <>
            <div className="card hidden overflow-x-auto p-0 md:block"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">No.</th>{cols.map((f) => <th key={f.key} className="th">{f.label}</th>)}<th className="th">Status</th></tr></thead>
              <tbody>{rows.map((r: any) => <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface"><td className="td"><Link className="font-medium underline" href={`/m/${key}/${r.id}`}>{r.number}</Link></td>{cols.map((f) => <td key={f.key} className="td">{showValue(f, r.data[f.key])}</td>)}<td className="td"><span className="badge">{label(r.status)}</span></td></tr>)}</tbody></table></div>
            <ul className="space-y-2 md:hidden">{rows.map((r: any) => <li key={r.id}><Link href={`/m/${key}/${r.id}`} className="card block !p-4"><p className="font-semibold">{r.number}</p>{cols.slice(0, 2).map((f) => <p key={f.key} className="text-sm text-muted">{f.label}: {showValue(f, r.data[f.key])}</p>)}<span className="badge mt-2">{label(r.status)}</span></Link></li>)}</ul></>)}
      </div>
    );
  });
}

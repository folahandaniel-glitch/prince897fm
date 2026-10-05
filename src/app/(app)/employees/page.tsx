import Link from 'next/link';
import { page } from '@/server/session';
import { listEmployees } from '@/server/hr';
import { term } from '@/domain/config-schema';

export const metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

export default async function Employees({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    const pageNo = Math.max(1, Number(sp.page) || 1);
    const rows = await listEmployees(p.ctx, { search: sp.q, limit: 25, offset: (pageNo - 1) * 25 });
    const E = term(p.terms, 'employee', 'plural'), e1 = term(p.terms, 'employee'), D = term(p.terms, 'department'), B = term(p.terms, 'branch'), P = term(p.terms, 'position');
    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{E}</h1>
          {p.allowed('employee:create') && <Link href="/employees/new" className="btn-primary">Add {e1.toLowerCase()}</Link>}
        </header>
        <form className="flex gap-2" role="search"><label className="sr-only" htmlFor="q">Search {E.toLowerCase()}</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder={`Search by name, number or email`} className="input max-w-md" /><button className="btn-ghost">Search</button></form>

        {rows.length === 0 ? (
          <div className="card text-center"><p className="font-semibold">No {E.toLowerCase()} found</p>
            <p className="mt-1 text-sm text-muted">{sp.q ? 'Try a different search.' : `Add your first ${e1.toLowerCase()} to get started.`}</p>
            {!sp.q && p.allowed('employee:create') && <Link href="/employees/new" className="btn-primary mt-3">Add {e1.toLowerCase()}</Link>}</div>
        ) : (
          <>
            <div className="card hidden overflow-x-auto p-0 md:block">
              <table className="w-full"><thead><tr className="border-b border-line"><th className="th">No.</th><th className="th">Name</th><th className="th">{D}</th><th className="th">{P}</th><th className="th">{B}</th><th className="th">Status</th></tr></thead>
                <tbody>{rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface">
                    <td className="td">{r.employee_no}</td><td className="td font-medium"><Link className="text-brand underline" href={`/employees/${r.id}`}>{r.full_name}</Link></td>
                    <td className="td">{r.department ?? '—'}</td><td className="td">{r.position ?? '—'}</td><td className="td">{r.branch ?? '—'}</td><td className="td"><span className="badge">{r.status}</span></td>
                  </tr>))}</tbody></table>
            </div>
            <ul className="space-y-3 md:hidden">{rows.map((r: any) => (
              <li key={r.id} className="card"><Link href={`/employees/${r.id}`} className="font-semibold text-brand underline">{r.full_name}</Link>
                <p className="text-sm text-muted">{r.employee_no} · {r.position ?? '—'}</p><p className="text-sm">{r.department ?? '—'} · {r.branch ?? '—'}</p><span className="badge mt-2">{r.status}</span></li>))}</ul>
            <nav className="flex justify-between" aria-label="Pagination">
              {pageNo > 1 ? <Link className="btn-ghost" href={`?q=${sp.q ?? ''}&page=${pageNo - 1}`}>Previous</Link> : <span />}
              {rows.length === 25 && <Link className="btn-ghost" href={`?q=${sp.q ?? ''}&page=${pageNo + 1}`}>Next</Link>}
            </nav>
          </>
        )}
      </div>
    );
  });
}

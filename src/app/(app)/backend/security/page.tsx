import { page, mutate, field } from '@/server/session';
import { killSession, securityOverview } from '@/server/backend';
import { ActionForm } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Security · BackEnd' };
export const dynamic = 'force-dynamic';

async function kill(_p: unknown, f: FormData) { 'use server'; return mutate(['/backend/security'], async (c) => { await killSession(c, field(f, 'id')); return 'Session ended.'; }); }

export default async function Security() {
  return page(async (p) => {
    const s = await securityOverview(p.ctx, p.org.slug);
    const when = (d: any) => new Date(d).toLocaleString(p.org.locale, { timeZone: p.org.timezone });
    return (
      <div className="space-y-5">
        {s.noMfa.length > 0 && <Notice tone="warn">{s.noMfa.length} privileged account(s) have no two-step verification: {s.noMfa.map((x: any) => x.email).join(', ')}. Ask them to enable it under Account → Security.</Notice>}
        <section className="card" aria-labelledby="ses"><h2 id="ses" className="font-semibold">Active sessions</h2>
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[36rem]"><thead><tr className="border-b border-line"><th className="th">User</th><th className="th">Signed in</th><th className="th">IP</th><th className="th">Device</th><th className="th" /></tr></thead>
            <tbody>{s.sessions.map((x: any) => <tr key={x.id} className="border-b border-line last:border-0"><td className="td">{x.email}</td><td className="td">{when(x.created_at)}</td><td className="td">{x.ip ?? '-'}</td><td className="td max-w-[14rem] truncate text-xs text-muted">{x.user_agent ?? ''}</td><td className="td text-right"><ActionForm action={kill as any} submit="End" tone="ghost" className="!mt-0"><input type="hidden" name="id" value={x.id} /><span /></ActionForm></td></tr>)}</tbody></table></div></section>
        <section className="card" aria-labelledby="att"><h2 id="att" className="font-semibold">Recent sign-in attempts</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{s.attempts.length === 0 ? <li className="py-2 text-muted">None recorded.</li> : s.attempts.map((a: any, i: number) => <li key={i} className="flex justify-between py-1.5"><span>{String(a.key).split(':').slice(1).join(':')}</span><span className={a.success ? 'text-emerald-700' : 'text-red-700'}>{a.success ? 'success' : 'failed'} · {when(a.created_at)}</span></li>)}</ul></section>
      </div>
    );
  });
}

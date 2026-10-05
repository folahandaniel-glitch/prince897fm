import Link from 'next/link';
import { page, mutate } from '@/server/session';
import { dashboardStats, markNotificationsRead, myNotifications } from '@/server/hr';
import { activeAnnouncements } from '@/server/calendar';
import { followUpsDue } from '@/server/crm';
import { term } from '@/domain/config-schema';
import { ActionForm } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Stat } from '@/components/ui';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

async function markRead() {
  'use server';
  return mutate(['/dashboard'], async (c) => { await markNotificationsRead(c); return 'All notifications marked as read.'; });
}

const greeting = (tz: string) => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default async function Dashboard() {
  return page(async (p) => {
    const stats = p.allowed('employee:view') ? await dashboardStats(p.ctx) : null;
    const [notes, notices, follow] = await Promise.all([myNotifications(p.ctx), activeAnnouncements(p.ctx), p.feature('crm') ? followUpsDue(p.ctx, 0) : Promise.resolve([])]);
    const emp = term(p.terms, 'employee', 'plural');
    const tiles = [
      ['/attendance', 'clock', 'Clock in / out', 'Attendance and exceptions', 'attendance:clock', 'attendance'],
      ['/payslips', 'wallet', 'My payslips', 'View, print or download', 'payslip:view:own', 'payroll'],
      ['/tasks', 'check', 'My tasks', 'What is on your plate', 'task:create', 'tasks'],
      ['/reports', 'doc', 'Reports', 'Weekly and monthly', 'report:submit', 'reports'],
      ['/leave', 'calendar', 'Leave', 'Balances and requests', 'leave:request', 'attendance'],
      ['/tickets', 'headset', 'Get support', 'Report a fault or ask for help', 'ticket:create', 'tickets'],
      ['/discipline', 'scale', 'Warnings & queries', 'Records about you', 'discipline:view:own', 'discipline'],
      ['/mail', 'mail', 'Mail', 'Messages from colleagues', 'mail:use', 'mail'],
    ].filter(([, , , , perm, feat]) => p.allowed(perm as string) && p.feature(feat as string));
    return (
      <div className="space-y-6">
        <section className="hero"><p className="text-sm text-white/80">{greeting(p.org.timezone)}</p><h1 className="text-2xl font-bold sm:text-3xl">{p.email.split('@')[0].replace(/[._]/g, ' ')}</h1><p className="mt-1 text-sm text-white/80">{p.branding.name}{p.branding.tagline ? ` · ${p.branding.tagline}` : ''}</p></section>

        {notices.length > 0 && <section aria-label="Announcements" className="space-y-2">{notices.map((a: any) => <div key={a.id} className="card flex gap-3 !border-accent/60"><span className="text-accent"><Icon name="bell" /></span><div><p className="font-semibold">{a.title}</p><p className="whitespace-pre-wrap text-sm text-muted">{a.body}</p></div></div>)}</section>}

        <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(([href, icon, title, sub]) => (
          <Link key={href as string} href={href as string} className="card group flex flex-col gap-2 !p-4 transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-brand"><Icon name={icon as string} /></span><span className="font-semibold leading-tight">{title}</span><span className="text-xs text-muted">{sub}</span></Link>))}</section>

        {stats && <section aria-label="Overview" className="grid gap-3 sm:grid-cols-3">
          <Stat label={emp} value={stats.employees.total} sub={`${stats.employees.active} active`} href="/employees" />
          {p.allowed('registration:review') && <Stat label="Registrations to review" value={stats.pending} href="/requests" />}
          <div className="stat"><p className="text-xs font-medium uppercase tracking-wide text-muted">By {term(p.terms, 'department').toLowerCase()}</p><ul className="mt-2 space-y-1 text-sm">{stats.byDept.slice(0, 5).map((d: any) => <li key={d.name} className="flex justify-between"><span className="truncate">{d.name}</span><span className="font-semibold">{d.n}</span></li>)}</ul></div></section>}

        {follow.length > 0 && <section className="card"><h2 className="font-semibold">Client follow-ups due</h2><ul className="mt-2 divide-y divide-line text-sm">{follow.slice(0, 5).map((f: any) => <li key={f.id} className="py-2"><Link className="font-medium underline" href={`/crm/${f.account_id}`}>{f.account}</Link> · {f.summary}</li>)}</ul></section>}

        <section id="notifications" className="card" aria-labelledby="notif-h">
          <div className="flex items-center justify-between"><h2 id="notif-h" className="font-semibold">Notifications</h2>{p.unread > 0 && <ActionForm action={markRead} submit="Mark all read" tone="ghost" className="!mt-0"><span /></ActionForm>}</div>
          {notes.length === 0 ? <p className="mt-3 text-sm text-muted">You are all caught up. Approvals, payslips, deadlines and replies will show up here.</p> : (
            <ul className="mt-3 divide-y divide-line">{notes.map((n: any) => (
              <li key={n.id} className="py-3">{n.href ? <Link href={n.href} className={`text-sm hover:underline ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</Link> : <p className={`text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</p>}{n.body && <p className="text-sm text-muted">{n.body}</p>}
                <p className="text-xs text-muted">{new Date(n.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}</p></li>))}</ul>)}
        </section>
      </div>
    );
  });
}

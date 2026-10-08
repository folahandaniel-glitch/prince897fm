import Link from 'next/link';
import { page, mutate } from '@/server/session';
import { dashboardStats, markNotificationsRead, myNotifications } from '@/server/hr';
import { followUpsDue } from '@/server/crm';
import { marketingStats, incomeTrend, onDutyToday, stationPulse, upcomingAnniversaries, upcomingBirthdays, upcomingEvents } from '@/server/overview';
import { myCard, myTrend } from '@/server/kpi';
import { listAssessments } from '@/server/assessment';
import { term } from '@/domain/config-schema';
import { ActionForm } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Avatar } from '@/components/avatar';
import { Stat } from '@/components/ui';
import { ColumnChart, Donut, Gauge, HBars, Sparkline } from '@/components/charts';
import { formatMoney } from '@/domain/finance';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

async function markRead() {
  'use server';
  return mutate(['/dashboard'], async (c) => { await markNotificationsRead(c); return 'All notifications marked as read.'; });
}

const greeting = (tz: string) => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const STAGE: Record<string, string> = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const when = (iso: string, tz: string, loc: string) => new Date(iso).toLocaleString(loc, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const Card = ({ title, icon, href, children, className = '' }: { title: string; icon: string; href?: string; children: React.ReactNode; className?: string }) => (
  <section className={`card min-w-0 ${className}`}><div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-brand"><Icon name={icon} className="h-4 w-4" /></span>{title}</h2>{href && <Link href={href} className="text-xs font-medium underline">Open</Link>}</div>{children}</section>
);

export default async function Dashboard() {
  return page(async (p) => {
    const period = new Date().toISOString().slice(0, 7);
    const stats = p.allowed('employee:view') ? await dashboardStats(p.ctx) : null;
    const [notes, follow, birthdays, anniversaries, duty, pulse, events, mk, income, kpi, trend, assess, due] = await Promise.all([
      myNotifications(p.ctx), p.feature('crm') ? followUpsDue(p.ctx, 0) : Promise.resolve([]),
      upcomingBirthdays(p.ctx), upcomingAnniversaries(p.ctx), onDutyToday(p.ctx), stationPulse(p.ctx), upcomingEvents(p.ctx),
      p.feature('crm') ? marketingStats(p.ctx) : Promise.resolve(null), p.feature('finance') ? incomeTrend(p.ctx) : Promise.resolve(null),
      p.allowed('kpi:view:own') && p.feature('kpi') ? myCard(p.ctx, period, 15).catch(() => null) : Promise.resolve(null),
      p.allowed('kpi:view:own') && p.feature('kpi') ? myTrend(p.ctx).catch(() => []) : Promise.resolve([]),
      p.allowed('assessment:take') && p.feature('kpi') ? listAssessments(p.ctx).catch(() => []) : Promise.resolve([]),
      p.ctx.subject.employeeId ? p.ctx.q.query<any>(`select id, title, due_date::text as d, priority from tasks where assignee_employee_id = $1 and status in ('todo','in_progress','blocked') and due_date <= current_date + 7 order by due_date limit 5`, [p.ctx.subject.employeeId]) : Promise.resolve([]),
    ]);
    const emp = term(p.terms, 'employee', 'plural');
    const k = { cur: p.org.currency, loc: p.org.locale };
    const money = (minor: number) => formatMoney(Math.round(minor), k.cur, k.loc); // the data is in minor units (kobo)
    const openAssess = assess.find((a: any) => a.state === 'open' && a.attempt_status !== 'submitted');
    const tiles = [
      ['/attendance', 'clock', 'Clock in / out', 'Attendance and exceptions', 'attendance:clock', 'attendance'],
      ['/payslips', 'wallet', 'My payslips', 'View, print or download', 'payslip:view:own', 'payroll'],
      ['/kpi', 'chart', 'My KPI', 'Score and what drives it', 'kpi:view:own', 'kpi'],
      ['/assessment', 'check', 'Monthly assessment', 'Product & service knowledge', 'assessment:take', 'kpi'],
      ['/tasks', 'check', 'My tasks', 'What is on your plate', 'task:create', 'tasks'],
      ['/reports', 'doc', 'Reports', 'Weekly and monthly', 'report:submit', 'reports'],
      ['/leave', 'calendar', 'Leave', 'Balances and requests', 'leave:request', 'attendance'],
      ['/tickets', 'headset', 'Get support', 'Report a fault or ask for help', 'ticket:create', 'tickets'],
    ].filter(([, , , , perm, feat]) => p.allowed(perm as string) && p.feature(feat as string));
    return (
      <div className="min-w-0 space-y-5">
        <section className="hero"><p className="text-sm text-white/80">{greeting(p.org.timezone)}</p><h1 className="text-2xl font-bold capitalize sm:text-3xl">{p.email.split('@')[0].replace(/[._]/g, ' ')}</h1><p className="mt-1 text-sm text-white/80">{p.branding.name}{p.branding.tagline ? ` · ${p.branding.tagline}` : ''}</p>
          <p className="mt-3 inline-flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/85"><span>👥 {pulse.staff} staff</span><span>🟢 {pulse.hereNow} here now</span><span>⏱ {pulse.clockedToday} clocked in today</span>{pulse.lateToday > 0 && <span>⚠ {pulse.lateToday} late</span>}</p></section>

        {openAssess && <Link href="/assessment" className="card flex items-center justify-between gap-3 !border-accent/60 hover:bg-surface"><span><strong>Monthly knowledge assessment is open</strong><span className="block text-sm text-muted">{openAssess.title}: {openAssess.question_count} questions, {openAssess.minutes} minutes, closes {openAssess.closes_on}. It counts towards your KPI.</span></span><span className="btn-primary shrink-0">Take it</span></Link>}

        <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(([href, icon, title, sub]) => (
          <Link key={href as string} href={href as string} className="card group flex min-w-0 flex-col gap-2 !p-4 transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-brand"><Icon name={icon as string} /></span><span className="font-semibold leading-tight">{title}</span><span className="text-xs text-muted">{sub}</span></Link>))}</section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {kpi && <Card title="My KPI this month" icon="chart" href="/kpi">
            <Gauge value={kpi.score} label="KPI score" sub={`${kpi.rating}${kpi.profile ? ` · ${kpi.profile}` : ''}`} />
            <div className="mt-3 flex items-center justify-between gap-3"><Sparkline values={trend.map((t) => t.score)} label="KPI trend" />{kpi.coverage < 100 && kpi.score != null && <p className="text-xs text-muted">Based on {Math.round(kpi.coverage)}% of the measures so far.</p>}</div>
          </Card>}

          <Card title="Birthdays & milestones" icon="bell">
            {birthdays.length === 0 && anniversaries.length === 0 ? <p className="text-sm text-muted">No birthdays or work anniversaries in the next 30 days. Add your own date of birth under <Link className="underline" href="/account/profile">My profile</Link>.</p> : (
              <ul className="divide-y divide-line text-sm">
                {birthdays.map((b) => <li key={`b-${b.name}`} className="flex items-center justify-between gap-2 py-2"><span className="flex min-w-0 items-center gap-2 truncate"><Avatar userId={b.userId} sha={b.sha} name={b.name} size={28} />🎂 <strong className="truncate">{b.name}</strong>{b.department && <span className="text-muted"> · {b.department}</span>}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.today ? 'bg-accent text-black' : 'bg-surface'}`}>{b.today ? 'Today!' : b.daysAway === 1 ? 'Tomorrow' : `${b.label} · ${b.daysAway}d`}</span></li>)}
                {anniversaries.map((b) => <li key={`a-${b.name}`} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate">🏅 <strong>{b.name}</strong> <span className="text-muted">· {b.years} year{b.years === 1 ? '' : 's'} with us</span></span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.today ? 'bg-accent text-black' : 'bg-surface'}`}>{b.today ? 'Today!' : `${b.label} · ${b.daysAway}d`}</span></li>)}
              </ul>)}
          </Card>

          {mk && <Card title="Marketing statistics" icon="briefcase" href={p.allowed('crm:view') ? '/crm' : undefined} className="lg:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-surface p-3"><p className="text-xs text-muted">Open opportunities</p><p className="text-xl font-bold tabular-nums">{mk.openCount}</p>{mk.money && <p className="text-xs text-muted">{money(mk.openValue)}</p>}</div>
              <div className="rounded-xl bg-surface p-3"><p className="text-xs text-muted">Deals won this month</p><p className="text-xl font-bold tabular-nums">{mk.wonThisMonth}</p>{mk.money && <p className="text-xs text-muted">{money(mk.wonValueThisMonth)}</p>}</div>
              <div className="rounded-xl bg-surface p-3"><p className="text-xs text-muted">New leads this month</p><p className="text-xl font-bold tabular-nums">{mk.newLeadsThisMonth}</p><p className="text-xs text-muted">{mk.clients} paying clients</p></div>
              <div className="rounded-xl bg-surface p-3"><p className="text-xs text-muted">Win rate</p><p className="text-xl font-bold tabular-nums">{mk.winRate == null ? '–' : `${mk.winRate}%`}</p><p className="text-xs text-muted">{mk.followUpsDue} follow-ups due</p></div>
            </div>
            <div className="mt-4 grid min-w-0 gap-5 md:grid-cols-2">
              <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">Sales pipeline</h3><HBars label="Opportunities by stage" money={false} data={mk.stages.filter((s) => s.stage !== 'lost').map((s) => ({ label: STAGE[s.stage], value: s.count, sub: mk.money && s.value ? money(s.value) : undefined }))} /></div>
              <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">Last six months: deals won and new leads</h3><ColumnChart label="Deals won and new leads by month" series={['Deals won', 'New leads']} data={mk.months.map((m) => ({ label: m.label, a: m.won, b: m.leads }))} /></div>
            </div>
            {mk.top.length > 0 && <div className="mt-4"><h3 className="mb-2 text-sm font-medium">Biggest open opportunities</h3><ul className="divide-y divide-line text-sm">{mk.top.map((t) => <li key={t.id} className="flex justify-between gap-2 py-1.5"><Link className="truncate underline" href={`/crm/${t.id}`}>{t.name}</Link><span className="shrink-0 font-semibold tabular-nums">{money(t.value)}</span></li>)}</ul></div>}
          </Card>}

          {income && <Card title="Income and spending" icon="coins" href="/finance/overview" className="lg:col-span-2">
            <ColumnChart label="Income and spending by month" series={['Income', 'Spending']} money data={income.map((m) => ({ label: m.label, a: m.income / 100, b: m.expense / 100 }))} />
          </Card>}

          <Card title="On duty today" icon="clock" href="/roster/mine">
            {duty.duty.length === 0 ? <p className="text-sm text-muted">Nobody is rostered today.</p> : <ul className="divide-y divide-line text-sm">{duty.duty.slice(0, 7).map((d, i) => <li key={i} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${d.here ? 'bg-green-500' : 'bg-slate-300'}`} aria-label={d.here ? 'here' : 'not clocked in'} />{d.name}<span className="text-muted"> · {d.department ?? d.shift}</span></span><span className="shrink-0 text-xs text-muted">{d.time}</span></li>)}</ul>}
            {duty.duty.length > 7 && <p className="mt-1 text-xs text-muted">and {duty.duty.length - 7} more</p>}
            {duty.leave.length > 0 && <p className="mt-3 text-xs text-muted">🌴 On leave: {duty.leave.slice(0, 6).map((l) => l.name).join(', ')}{duty.leave.length > 6 ? ` +${duty.leave.length - 6}` : ''}</p>}
          </Card>

          <Card title="Coming up" icon="calendar" href="/calendar">
            {events.length === 0 && due.length === 0 ? <p className="text-sm text-muted">Nothing scheduled in the next few days.</p> : <ul className="divide-y divide-line text-sm">
              {events.map((e) => <li key={e.id} className="py-1.5"><strong>{e.title}</strong><span className="block text-xs text-muted">{when(e.startsAt, p.org.timezone, p.org.locale)}{e.location ? ` · ${e.location}` : ''}</span></li>)}
              {due.map((t: any) => <li key={t.id} className="py-1.5"><Link className="underline" href={`/tasks/${t.id}`}>Task due: {t.title}</Link><span className="block text-xs text-muted">{t.d}{t.priority === 'urgent' || t.priority === 'high' ? ` · ${t.priority}` : ''}</span></li>)}
            </ul>}
          </Card>

          {stats && <Card title={emp} icon="people" href="/employees" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label={emp} value={stats.employees.total} sub={`${stats.employees.active} active`} href="/employees" />
              {p.allowed('registration:review') && <Stat label="Registrations to review" value={stats.pending} href="/requests" />}
              <div className="min-w-0"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">By {term(p.terms, 'department').toLowerCase()}</p><Donut label={`${emp} by ${term(p.terms, 'department').toLowerCase()}`} parts={stats.byDept.slice(0, 5).map((d: any) => ({ label: d.name, value: Number(d.n) }))} /></div>
            </div>
          </Card>}
        </div>

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

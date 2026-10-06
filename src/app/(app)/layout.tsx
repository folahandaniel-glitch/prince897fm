import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { shell } from '@/server/session';
import { can } from '@/domain/policy';
import { hasAccess } from '@/domain/builders';
import { destroySession, SESSION_COOKIE } from '@/server/auth';
import { hexToRgbTriplet, resolveLabel } from '@/domain/config-schema';
import { InstallMenuItem, ThemeToggle } from '@/components/pwa';
import { CommandPalette } from '@/components/palette';
import { SearchButton } from '@/components/search-button';
import { BottomNav, SideNav, type NavLinkItem } from '@/components/nav';
import { MenuDrawer } from '@/components/drawer';
import { Icon } from '@/components/icons';
import { AnnouncementCarousel } from '@/components/announcement-carousel';

async function logout() {
  'use server';
  const c = await cookies();
  await destroySession(c.get(SESSION_COOKIE)?.value);
  c.delete(SESSION_COOKIE);
  redirect('/login');
}

const QUICK = ['dashboard', 'attendance', 'tasks', 'payslips', 'reports', 'finance', 'crm', 'tickets-queue', 'executive'];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sh = await shell();
  const { branding: b, terms, nav } = sh.cfg;
  const allowed = (a: string) => can(sh.subject, a).allow;
  const roles = sh.subject.grants.map((g) => g.roleKey);
  const isSuper = sh.subject.grants.some((g) => g.permissions.includes('*'));

  const groups = new Map<string, NavLinkItem[]>();
  const add = (group: string, item: NavLinkItem) => { if (!groups.has(group)) groups.set(group, []); groups.get(group)!.push(item); };
  for (const it of nav.items) {
    if (it.hidden || (it.feature && sh.disabled.has(it.feature)) || (it.permission && !allowed(it.permission))) continue;
    add(it.group, { key: it.key, label: resolveLabel(it.label, terms), href: it.href, icon: it.icon });
  }
  // Modules, dashboards and pages built in the Builder appear automatically for the people allowed to see them.
  if (!sh.disabled.has('builders')) {
    for (const e of sh.extras.entities) if (isSuper || hasAccess(e.view, roles)) add(e.group, { key: `m-${e.key}`, label: e.plural, href: `/m/${e.key}`, icon: 'folder' });
    for (const d of sh.extras.dashboards) if (isSuper || hasAccess(d.roles, roles)) add('Dashboards', { key: `d-${d.slug}`, label: d.name, href: `/d/${d.slug}`, icon: 'chart' });
    for (const p of sh.extras.pages) if (isSuper || hasAccess(p.roles, roles)) add('Information', { key: `p-${p.slug}`, label: p.title, href: `/p/${p.slug}`, icon: 'doc' });
  }
  const grouped = [...groups];
  const flat = grouped.flatMap(([, items]) => items);
  const quick = QUICK.map((k) => flat.find((i) => i.key === k)).filter(Boolean).slice(0, 4) as NavLinkItem[];
  const style = { ['--brand' as string]: hexToRgbTriplet(b.primary), ['--brand-2' as string]: hexToRgbTriplet(b.secondary), ['--accent' as string]: hexToRgbTriplet(b.accent) };

  const Brand = b.logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={b.logoUrl} alt={b.name} width={400} height={110} decoding="async" fetchPriority="high" className="h-auto w-full max-w-[200px]" />
    : <p className="text-lg font-bold text-white">{b.shortName}</p>;

  return (
    <div style={style} className="min-h-[100dvh] lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="no-print hidden max-h-[100dvh] overflow-y-auto bg-[#0b0b0b] p-4 lg:sticky lg:top-0 lg:block" style={{ borderRight: `3px solid ${b.accent}` }}>
        <div className="mb-6 px-1">{Brand}</div>
        <SideNav groups={grouped} />
      </aside>
      <div className="flex min-h-[100dvh] flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-panel/90 px-3 py-2 backdrop-blur sm:px-4">
          <div className="flex items-center gap-2">
            <MenuDrawer groups={grouped} brand={Brand} />
            {b.markUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={b.markUrl} alt={b.shortName} width={44} height={32} decoding="async" className="h-8 w-auto rounded lg:hidden" />
              : <p className="font-semibold lg:hidden">{b.shortName}</p>}
            <p className="hidden text-sm text-muted lg:block">{sh.s.org_name}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <SearchButton />
            <Link href="/dashboard#notifications" className="btn-ghost relative" aria-label={`Notifications, ${sh.unread} unread`}><Icon name="bell" />{sh.unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-black">{sh.unread > 99 ? '99+' : sh.unread}</span>}</Link>
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none" aria-label="Account menu"><Icon name="user" /><span className="hidden max-w-[10rem] truncate sm:inline">{sh.s.email}</span></summary>
              <div className="absolute right-0 z-40 mt-2 w-72 space-y-3 rounded-xl border border-line bg-panel p-3 shadow-xl">
                <p className="truncate text-sm text-muted">{sh.s.email}</p>
                <ThemeToggle />
                <InstallMenuItem />
                <Link href="/account/notifications" className="btn-ghost w-full justify-start"><Icon name="bell" className="h-4 w-4" /> Notification settings</Link>
                <Link href="/account/security" className="btn-ghost w-full justify-start"><Icon name="lock" className="h-4 w-4" /> Security & password</Link>
                <form action={logout}><button className="btn-ghost w-full" type="submit">Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        {!sh.disabled.has('announcements') && <AnnouncementCarousel items={sh.announcements} canPost={can(sh.subject, 'announcement:post').allow} brandLogo={b.markUrl || undefined} />}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-3 pb-24 sm:p-6 lg:pb-8">{children}</main>
        <footer className="no-print border-t border-line px-4 pb-24 pt-4 text-center lg:pb-4">
          <p className="text-xs text-muted">{b.footer}</p>
          <p className="mt-1"><Link href="/backend" className="text-[9px] uppercase tracking-widest text-muted/60 hover:text-muted hover:underline">BackEnd</Link></p>
        </footer>
        <BottomNav items={quick} />
        <CommandPalette links={flat.map((i) => ({ label: i.label, href: i.href }))} />
      </div>
    </div>
  );
}

import Link from 'next/link';
import { shell } from '@/server/session';
import { can } from '@/domain/policy';
import { redirect } from 'next/navigation';

const TABS: [string, string][] = [['/backend', 'Overview'], ['/backend/users', 'Users'], ['/backend/roles', 'Roles'], ['/backend/features', 'Modules'], ['/backend/chairman', 'Assist Chairman'], ['/backend/security', 'Security'], ['/backend/account', 'My account'], ['/backend/config', 'Configuration'], ['/backend/organisations', 'Organisations']];

/** The BackEnd is reachable only by the Super Administrator. Everyone else is turned away before anything loads. */
export default async function BackendLayout({ children }: { children: React.ReactNode }) {
  const sh = await shell();
  if (!can(sh.subject, 'backend:access').allow) redirect('/forbidden');
  return (
    <div className="space-y-4">
      <div className="hero"><p className="text-xs font-semibold uppercase tracking-widest text-white/70">Super Administrator</p><h1 className="text-2xl font-bold sm:text-3xl">BackEnd control centre</h1><p className="mt-1 max-w-2xl text-sm text-white/80">Control users, access, modules and configuration for {sh.s.org_name}. Everything here is audited. This area and your account are invisible to other staff.</p></div>
      <nav aria-label="BackEnd sections" className="flex gap-2 overflow-x-auto pb-1">{TABS.map(([h, l]) => <Link key={h} href={h} className="btn-ghost shrink-0">{l}</Link>)}</nav>
      {children}
    </div>
  );
}

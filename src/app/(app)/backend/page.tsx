import Link from 'next/link';
import { page } from '@/server/session';
import { overview } from '@/server/backend';
import { Stat } from '@/components/ui';

export const metadata = { title: 'BackEnd' };
export const dynamic = 'force-dynamic';

const LINKS: [string, string, string][] = [
  ['/backend/users', 'Users & access', 'Create accounts, reset passwords, disable people, change roles.'],
  ['/backend/roles', 'Roles & permissions', 'Define what each role can do.'],
  ['/backend/features', 'Modules on/off', 'Switch whole modules on or off for this organisation.'],
  ['/backend/chairman', 'Assist the Chairman', 'See what is waiting for the Chairman and help clear it.'],
  ['/backend/security', 'Security', 'Sign-ins, active sessions, who has no two-step verification.'],
  ['/backend/config', 'Configuration', 'Export or import structure, modules and dashboards.'],
  ['/builder', 'Builder', 'Custom modules, forms, automations, dashboards, pages.'],
  ['/builder/wallboards', 'TV wallboards', 'Pair and disconnect office screens.'],
  ['/admin/config', 'Branding & terminology', 'Name, logo, colours, labels, with versions and rollback.'],
  ['/admin/audit', 'Audit trail', 'Every sensitive action, tamper-evident.'],
  ['/payroll/settings', 'Payroll settings', 'Tax bands, statutory rates, fine policies.'],
  ['/finance/setup', 'Finance setup', 'Chart of accounts, approval bands, periods.'],
];

export default async function Backend() {
  return page(async (p) => {
    const o = await overview(p.ctx);
    return (
      <div className="space-y-5">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Active users" value={o.users} sub={`${o.disabled} disabled`} /><Stat label="Staff" value={o.staff} /><Stat label="Signed in now" value={o.sessions} /><Stat label="Audit events (24h)" value={o.audit24} /><Stat label="Custom modules" value={o.modules} /></section>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{LINKS.map(([h, t, d]) => <li key={h}><Link href={h} className="card block h-full transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></Link></li>)}</ul>
        <section className="card"><h2 className="font-semibold">System</h2><p className="mt-1 text-sm text-muted">Database migrations applied: {o.migrations.length} (latest: {o.migrations[o.migrations.length - 1]?.name}).</p></section>
      </div>
    );
  });
}

import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs } from '@/server/ctx';
import { getPayslip } from '@/server/payroll';
import { buildPayslipPdf, logoFor } from '@/server/payslip-pdf';
import { resolveConfig } from '@/server/config';
import { ForbiddenError } from '@/domain/policy';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** A real PDF (not a print stylesheet): downloadable on any device. Employees can fetch only their own; payroll staff any (audited). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await boot();
  const { id } = await params;
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  try {
    const out = await runAs(s.org_id, s.user_id, async (c) => {
      const v = await getPayslip(c, id);
      if (!v) return null;
      const cfg = await resolveConfig(c.q, c.orgId);
      return { v, cfg };
    });
    if (!out) return new Response('Not found', { status: 404 });
    const { v, cfg } = out;
    const bytes = await buildPayslipPdf({ period: v.period, gross: v.gross, totalDeductions: v.totalDeductions, net: v.net, currency: v.org.currency, org: v.org, employee: v.employee, details: v.details as any, logoPath: logoFor(cfg.branding.iconBase), footer: `${cfg.branding.footer}  |  Computer-generated payslip. Confidential.` });
    const safe = String(v.employee.name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'payslip';
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="Payslip_${v.period}_${safe}.pdf"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    throw e;
  }
}

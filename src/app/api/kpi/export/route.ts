import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs, UserError } from '@/server/ctx';
import { ForbiddenError } from '@/domain/policy';
import { teamCards } from '@/server/kpi';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';
const cell = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : s; }; // spreadsheet formula injection guard
const q = (v: unknown) => `"${cell(v).replace(/"/g, '""')}"`;

/** CSV of the monthly KPI for everyone the signed-in person may see. */
export async function GET(req: Request) {
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Please sign in.', { status: 401 });
  const period = new URL(req.url).searchParams.get('period') ?? new Date().toISOString().slice(0, 7);
  try {
    const rows = await runAs(s.org_id, s.user_id, (c) => teamCards(c, period));
    const head = ['Name', 'Department', 'Position', 'Level', 'Month', 'Score', 'Rating', 'Data coverage %', 'Status'];
    const lines = [head.map(q).join(','), ...rows.map((r) => [r.name, r.department, r.position, r.band, r.period, r.score ?? '', r.rating, r.coverage, r.status].map(q).join(','))];
    return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kpi-${period}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Not permitted.', { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}

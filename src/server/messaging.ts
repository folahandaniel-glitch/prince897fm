import { privileged, type Q } from './db';

/**
 * Outbound messages (email / SMS). Requests only enqueue rows in `outbox`; a cron sweep delivers them through a provider adapter,
 * so a slow or failing provider never blocks a page. With no provider configured, rows are marked "skipped" (in-app notices still work).
 *
 * Email: Resend (RESEND_API_KEY, MAIL_FROM).  SMS: Termii (TERMII_API_KEY, TERMII_SENDER).
 */
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
export const smsConfigured = () => !!process.env.TERMII_API_KEY;

export async function enqueue(q: Q, orgId: string, m: { userId?: string | null; channel: 'email' | 'sms'; to: string; subject?: string; body: string; dedupeKey?: string }) {
  if (!m.to) return;
  await q.query(`insert into outbox (org_id, user_id, channel, to_addr, subject, body, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
    [orgId, m.userId ?? null, m.channel, m.to, m.subject?.slice(0, 200) ?? null, m.body.slice(0, 4000), m.dedupeKey ?? null]);
}

/** Notification rows carry a relative "link:/path" marker; turn it into an absolute URL when APP_URL is set. */
const withLink = (b: string) => b.replace(/link:(\/\S*)/, (_, p: string) => (process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') + p : ''));

async function sendEmail(to: string, subject: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Email provider ${r.status}`);
}
async function sendSms(to: string, text: string) {
  const r = await fetch('https://api.ng.termii.com/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, from: process.env.TERMII_SENDER ?? 'WorkSuite', sms: text.slice(0, 600), type: 'plain', channel: 'generic', api_key: process.env.TERMII_API_KEY }), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`SMS provider ${r.status}`);
}

/** Deliver pending messages (called by cron). Returns counts. */
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const p = await privileged();
  const rows = await p.query<any>(`select id, channel, to_addr, subject, body, attempts from outbox where status = 'pending' order by created_at limit $1`, [limit]);
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const m of rows) {
    const configured = m.channel === 'email' ? emailConfigured() : smsConfigured();
    if (!configured) { await p.query(`update outbox set status = 'skipped', error = 'No provider configured' where id = $1`, [m.id]); out.skipped++; continue; }
    try {
      if (m.channel === 'email') await sendEmail(m.to_addr, m.subject ?? 'Notification', withLink(m.body)); else await sendSms(m.to_addr, m.body);
      await p.query(`update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1`, [m.id]); out.sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      await p.query(`update outbox set status = $2, attempts = $3, error = $4 where id = $1`, [m.id, attempts >= 3 ? 'failed' : 'pending', attempts, String((e as Error).message).slice(0, 200)]);
      out.failed++;
    }
  }
  return out;
}

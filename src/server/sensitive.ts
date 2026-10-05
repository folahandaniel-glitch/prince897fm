import { decryptSecret, encryptSecret } from './mfa';
import type { Q } from './db';

/**
 * Field-level protection for identifiers that would be damaging if a database dump leaked (bank account, tax id, pension PIN).
 * Values are sealed with AES-256-GCM (key derived from APP_SECRET) and stored with an "enc:" prefix, so legacy plaintext rows still read
 * and are sealed lazily. Frozen payslips only ever keep a masked form.
 */
const PREFIX = 'enc:';
export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX);
export const seal = (v: string | null | undefined): string | null => (v && v.trim() ? PREFIX + encryptSecret(v.trim()) : null);
export function unseal(v: string | null | undefined): string | null {
  if (!v) return null;
  if (!isSealed(v)) return v;
  try { return decryptSecret(v.slice(PREFIX.length)); } catch { return null; } // wrong APP_SECRET: show nothing rather than ciphertext
}
/** "****1234": last four characters only. */
export const mask = (v: string | null | undefined): string | null => { const p = unseal(v); return p ? `****${p.slice(-4)}` : null; };

/** Seals any plaintext values left from before encryption existed. Idempotent; safe to run from cron. */
export async function sealLegacy(q: Q): Promise<number> {
  const rows = await q.query<any>(`select id, bank_account, tax_id, pension_pin from comp_profiles where (bank_account is not null and bank_account not like 'enc:%') or (tax_id is not null and tax_id not like 'enc:%') or (pension_pin is not null and pension_pin not like 'enc:%')`);
  for (const r of rows) await q.query('update comp_profiles set bank_account = $2, tax_id = $3, pension_pin = $4 where id = $1', [r.id, seal(unseal(r.bank_account)), seal(unseal(r.tax_id)), seal(unseal(r.pension_pin))]);
  return rows.length;
}

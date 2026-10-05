import { privileged } from './db';
import { decryptWith, encryptWith } from './mfa';

const PREFIX = 'enc:';

/** Re-encrypts one stored value from oldSecret to newSecret. Already-rotated values (readable with the new key) are left alone, so reruns are safe. */
function rotateValue(blob: string, oldSecret: string, newSecret: string): string | null {
  try { decryptWith(newSecret, blob); return null; } catch { /* not yet rotated */ }
  return encryptWith(newSecret, decryptWith(oldSecret, blob)); // throws if the old secret is wrong: nothing is written for that row
}

/**
 * Moves every secret stored at rest (MFA authenticator secrets, bank account, tax id, pension PIN) from one APP_SECRET to another.
 * Idempotent. Run with the owner connection, then switch APP_SECRET in the environment.
 */
export async function rotateSecrets(oldSecret: string, newSecret: string): Promise<{ mfa: number; payroll: number }> {
  if (oldSecret === newSecret) throw new Error('The new secret must differ from the old one.');
  if (newSecret.length < 32) throw new Error('Use a new secret of at least 32 characters.');
  const p = await privileged();
  let mfa = 0, payroll = 0;
  for (const u of await p.query<any>('select id, mfa_secret_enc from users where mfa_secret_enc is not null')) {
    const next = rotateValue(u.mfa_secret_enc, oldSecret, newSecret);
    if (next) { await p.query('update users set mfa_secret_enc = $2 where id = $1', [u.id, next]); mfa++; }
  }
  for (const r of await p.query<any>(`select id, bank_account, tax_id, pension_pin from comp_profiles where bank_account like 'enc:%' or tax_id like 'enc:%' or pension_pin like 'enc:%'`)) {
    const f = (v: string | null) => (v && v.startsWith(PREFIX) ? rotateValue(v.slice(PREFIX.length), oldSecret, newSecret) : null);
    const [a, t, n] = [f(r.bank_account), f(r.tax_id), f(r.pension_pin)];
    if (a || t || n) {
      await p.query('update comp_profiles set bank_account = coalesce($2, bank_account), tax_id = coalesce($3, tax_id), pension_pin = coalesce($4, pension_pin) where id = $1', [r.id, a && PREFIX + a, t && PREFIX + t, n && PREFIX + n]);
      payroll++;
    }
  }
  return { mfa, payroll };
}

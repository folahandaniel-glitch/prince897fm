import { rotateSecrets } from '../src/server/rotate';

/**
 * Usage (DATABASE_URL must be set):
 *   OLD_APP_SECRET=... NEW_APP_SECRET=... npx tsx scripts/rotate-secret.ts
 * Then set APP_SECRET to the new value in Vercel and redeploy. Safe to run again if interrupted.
 * Tip: set APP_SECRET_PREVIOUS to the old value during the switch so no request fails while the deploy rolls out.
 */
const { OLD_APP_SECRET, NEW_APP_SECRET } = process.env;
if (!OLD_APP_SECRET || !NEW_APP_SECRET) { console.error('Set OLD_APP_SECRET and NEW_APP_SECRET.'); process.exit(1); }
const r = await rotateSecrets(OLD_APP_SECRET, NEW_APP_SECRET);
console.log(`Re-encrypted ${r.mfa} authenticator secret(s) and ${r.payroll} payroll record(s). Now set APP_SECRET to the new value and redeploy.`);
process.exit(0);

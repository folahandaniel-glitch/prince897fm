import { createOrganization } from '../src/server/backend';
import { ORG_TEMPLATES } from '../src/domain/templates';

/**
 * Usage: npx tsx scripts/provision.ts <slug> "<Organisation name>" <admin-email> [template] [super-admin-email]
 * Needs DATABASE_URL (and APP_SECRET) for a real database. Prints one-time passwords; they must be changed at first sign-in.
 */
const [slug, name, email, template = 'blank', sa] = process.argv.slice(2);
if (!slug || !name || !email) { console.error(`Usage: provision.ts <slug> "<name>" <admin-email> [template: ${ORG_TEMPLATES.map((t) => t.key).join('|')}] [super-admin-email]`); process.exit(1); }

const r = await createOrganization({ slug, name, templateKey: template, adminEmail: email, superAdminEmail: sa }, null);
console.log(`Organisation "${name}" created. Sign-in code: ${r.slug}\nAdmin: ${email}\nOne-time password (store securely, then change it): ${r.adminPassword}`);
if (r.superAdminPassword) console.log(`Super Admin: ${sa}\nOne-time password: ${r.superAdminPassword}`);
process.exit(0);

import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { publicBrandImage, saveBrandImage, sniffImage } from '../src/server/brand';
import { getDraft, publishDraft, resolveConfig, saveDraft } from '../src/server/config';
import type { Branding } from '../src/domain/config-schema';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);

const png = (pad = 200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(pad, 7)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(200, 2)]);

beforeAll(async () => {
  for (const t of TEMPLATES) await seedOrganization(t, []);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  ids.other = (await p.query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
  for (const [k, e] of Object.entries({ admin: 'admin', presenter: 'presenter' })) u[k] = (await p.query<any>(`select u.id from users u where u.org_id = $1 and u.email = $2`, [ids.org, `${e}@prince897.example`]))[0].id;
});

describe('image sniffing', () => {
  it('accepts PNG, JPEG and WebP by content, and rejects SVG, HTML and junk', () => {
    expect(sniffImage(png())?.mime).toBe('image/png');
    expect(sniffImage(jpg)?.mime).toBe('image/jpeg');
    expect(sniffImage(webp)?.mime).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html></html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('logo upload', () => {
  it('only branding managers can upload, and bad files are refused', async () => {
    await expect(as('presenter', (c) => saveBrandImage(c, 'logo', png()))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('admin', (c) => saveBrandImage(c, 'logo', Buffer.alloc(0)))).rejects.toThrow(/Choose an image/);
    await expect(as('admin', (c) => saveBrandImage(c, 'logo', Buffer.from('<svg></svg>')))).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(as('admin', (c) => saveBrandImage(c, 'logo', png(1_100_000)))).rejects.toThrow(/larger than 1 MB/);
  });

  it('goes into the draft, is served by content hash, and goes live only on publish', async () => {
    const before = (await as('admin', (c) => resolveConfig(c.q, c.orgId))).branding;
    const url = await as('admin', (c) => saveBrandImage(c, 'logo', png()));
    expect(url).toMatch(/^\/api\/brand\/prince897\/logo\?v=[0-9a-f]{10}$/);
    const draft = (await as('admin', (c) => getDraft<Branding>(c.q, 'branding')))!;
    expect(draft.logoUrl).toBe(url);
    expect(draft.name).toBe(before.name);           // other branding is kept
    expect(draft.markUrl).toBe(before.markUrl);
    // not live yet
    expect((await as('presenter', (c) => resolveConfig(c.q, c.orgId))).branding.logoUrl).toBe(before.logoUrl);
    await as('admin', (c) => publishDraft(c, 'branding', 'new logo'));
    expect((await as('presenter', async (c) => { const { invalidateConfig } = await import('../src/server/config'); invalidateConfig(c.orgId); return resolveConfig(c.q, c.orgId); })).branding.logoUrl).toBe(url);
  });

  it('serves the exact bytes publicly, replaces on re-upload, and keeps tenants apart', async () => {
    await as('admin', (c) => saveBrandImage(c, 'mark', jpg));
    const img = await publicBrandImage('prince897', 'mark');
    expect(img?.mime).toBe('image/jpeg');
    expect(img!.bytes.equals(jpg)).toBe(true);
    await as('admin', (c) => saveBrandImage(c, 'mark', webp));
    expect((await publicBrandImage('prince897', 'mark'))?.mime).toBe('image/webp');
    expect(await publicBrandImage('gracechapel', 'mark')).toBeNull();
    expect(await publicBrandImage('prince897', 'banner')).toBeNull();
    expect(await publicBrandImage('../etc', 'logo')).toBeNull();
    expect(await withTenant(ids.other, (q) => q.query('select * from org_assets'))).toHaveLength(0);
    expect((await withTenant(ids.org, (q) => q.query('select kind from org_assets'))).length).toBe(2);
  });

  it('editing branding text after an upload keeps the uploaded images', async () => {
    const base = (await as('admin', (c) => getDraft<Branding>(c.q, 'branding'))) ?? (await as('admin', (c) => resolveConfig(c.q, c.orgId))).branding;
    await as('admin', (c) => saveDraft(c, 'branding', { ...base, tagline: 'New tagline' }));
    const d = (await as('admin', (c) => getDraft<Branding>(c.q, 'branding')))!;
    expect(d.tagline).toBe('New tagline');
    expect(d.logoUrl).toMatch(/^\/api\/brand\/prince897\/logo/);
  });
});

describe('Super Admin created after setup', () => {
  it('is hidden, platform-level, and must change the one-time password at first sign-in', async () => {
    const { createSuperAdmin } = await import('../src/server/seed');
    const org = (await (await privileged()).query<any>(`insert into organizations (slug, name) values ('fresh-org','Fresh') returning id`))[0].id;
    const r = await createSuperAdmin(org, 'Root@Fresh.Example', null);
    expect(r.password.length).toBeGreaterThanOrEqual(16);
    const row = (await (await privileged()).query<any>('select email, hidden, platform_admin, must_change_password from users where id = $1', [r.userId]))[0];
    expect(row).toMatchObject({ email: 'root@fresh.example', hidden: true, platform_admin: true, must_change_password: true });
  });
});

describe('changing the sign-in email', () => {
  it('needs the current password, refuses duplicates, and works for sign-in afterwards', async () => {
    const { changeLoginEmail, login, hashPassword } = await import('../src/server/auth');
    const p = await privileged();
    const org = (await p.query<any>(`select id from organizations where slug = 'fresh-org'`))[0].id;
    await p.query(`update users set password_hash = $2 where org_id = $1 and platform_admin`, [org, hashPassword('long-enough-passphrase-1')]);
    const uid = (await p.query<any>('select id from users where org_id = $1 and platform_admin', [org]))[0].id;
    expect(await changeLoginEmail(uid, 'wrong-password-here-1', 'new@fresh.example')).toMatch(/current password/);
    expect(await changeLoginEmail(uid, 'long-enough-passphrase-1', 'not-an-email')).toMatch(/valid email/);
    expect(await changeLoginEmail(uid, 'long-enough-passphrase-1', 'root@fresh.example')).toMatch(/already your/);
    await p.query(`insert into users (org_id, email, password_hash) values ($1,'taken@fresh.example','x')`, [org]);
    expect(await changeLoginEmail(uid, 'long-enough-passphrase-1', 'Taken@Fresh.Example')).toMatch(/already used/);
    expect(await changeLoginEmail(uid, 'long-enough-passphrase-1', 'New@Fresh.Example')).toBeNull();
    expect((await login('fresh-org', 'new@fresh.example', 'long-enough-passphrase-1')).ok).toBe(true);
    expect((await login('fresh-org', 'root@fresh.example', 'long-enough-passphrase-1')).ok).toBe(false);
  });
});

describe('setup with a chosen Super Admin password', () => {
  it('uses the chosen password (no forced change), refuses weak ones and refuses reusing the admin email', async () => {
    const { createOrganization } = await import('../src/server/backend');
    const { login } = await import('../src/server/auth');
    const p = await privileged();
    const base = { slug: 'chosen-org', name: 'Chosen', templateKey: 'blank', adminEmail: 'admin@chosen.example', superAdminEmail: 'owner@chosen.example' };
    await expect(createOrganization({ ...base, superAdminPassword: 'short1!' }, null)).rejects.toThrow(/12 characters/);
    await expect(createOrganization({ ...base, superAdminEmail: 'ADMIN@chosen.example', superAdminPassword: 'a-fine-long-passphrase-9' }, null)).rejects.toThrow(/different email/);
    expect(await p.query(`select 1 from organizations where slug = 'chosen-org'`)).toHaveLength(0); // nothing was created by the refusals
    const r = await createOrganization({ ...base, superAdminPassword: 'a-fine-long-passphrase-9' }, null);
    expect(r.superAdminPassword).toBeNull();
    expect(r.superAdminChosePassword).toBe(true);
    const row = (await p.query<any>(`select must_change_password, hidden, platform_admin from users where email = 'owner@chosen.example'`))[0];
    expect(row).toEqual({ must_change_password: false, hidden: true, platform_admin: true });
    expect((await login('chosen-org', 'owner@chosen.example', 'a-fine-long-passphrase-9')).ok).toBe(true);
    // the administrator still gets a one-time password that must be changed
    expect((await p.query<any>(`select must_change_password from users where email = 'admin@chosen.example'`))[0].must_change_password).toBe(true);
  });
});

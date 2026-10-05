import { describe, expect, it, vi } from 'vitest';

describe('DB_SCHEMA keeps WorkSuite out of the public schema', () => {
  it('creates every table in the dedicated schema and still works end to end', async () => {
    process.env.DB_SCHEMA = 'ws_isolated';
    delete (globalThis as any).__ws;
    vi.resetModules();
    const { privileged, withTenant } = await import('../src/server/db');
    const { seedOrganization, TEMPLATES } = await import('../src/server/seed');
    const p = await privileged();
    const where = async (schema: string) => Number((await p.query<any>(`select count(*)::int n from information_schema.tables where table_schema = $1 and table_name in ('users','organizations','sessions','audit_events','fin_invoices')`, [schema]))[0].n);
    expect(await where('public')).toBe(0);
    expect(await where('ws_isolated')).toBe(5);
    await seedOrganization(TEMPLATES[0], []);
    const orgId = (await p.query<any>('select id from organizations limit 1'))[0].id;
    // row-level security and the app role still work inside the schema
    expect(Number((await withTenant(orgId, (q) => q.query<any>('select count(*)::int n from users')))[0].n)).toBeGreaterThan(0);
    const other = (await p.query<any>(`insert into organizations (slug, name) values ('zz','Other') returning id`))[0].id;
    expect(await withTenant(other, (q) => q.query('select * from users'))).toHaveLength(0);
    delete process.env.DB_SCHEMA; delete (globalThis as any).__ws;
  });
  it('rejects unsafe schema names', async () => {
    process.env.DB_SCHEMA = 'bad name; drop table x';
    delete (globalThis as any).__ws;
    vi.resetModules();
    await expect(import('../src/server/db')).rejects.toThrow(/DB_SCHEMA/);
    delete process.env.DB_SCHEMA; delete (globalThis as any).__ws;
  });
});

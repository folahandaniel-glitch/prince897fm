import fs from 'node:fs';
import path from 'node:path';

/** Minimal driver-neutral query surface. Embedded Postgres (PGlite) in dev/test, `postgres` in production. */
export interface Q {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver {
  privileged: Q;
  script(sql: string): Promise<void>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

const g = globalThis as unknown as { __ws?: Promise<Driver> };

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  let driver: Driver;
  if (url) {
    const { default: postgres } = await import('postgres');
    // prepare:false keeps this compatible with transaction-mode poolers (Neon, Supabase, PgBouncer) used on serverless hosts.
    const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
    driver = {
      privileged: { query: async (s, p) => (await sql.unsafe(s, p as any[])) as any },
      script: async (text) => { await sql.unsafe(text); },
      tx: (fn) => sql.begin(async (t) => fn({ query: async (s, p) => (await t.unsafe(s, p as any[])) as any })) as any,
    };
  } else {
    if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'force') {
      throw new Error('DATABASE_URL is not set. Production needs a managed PostgreSQL database: see README (Deploy to Vercel).');
    }
    const { PGlite } = await import('@electric-sql/pglite');
    const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
    const dir = process.env.PGLITE_DIR === 'memory' ? undefined : process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pg');
    if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
    const db = dir ? new PGlite(dir, { extensions: { btree_gist } }) : new PGlite({ extensions: { btree_gist } });
    await db.waitReady;
    driver = {
      privileged: { query: async (s, p) => (await db.query(s, p as any[])).rows as any },
      script: async (text) => { await db.exec(text); },
      tx: (fn) => db.transaction(async (t) => fn({ query: async (s, p) => (await t.query(s, p as any[])).rows as any })),
    };
  }
  await migrate(driver);
  return driver;
}

async function migrate(d: Driver) {
  // Serialise concurrent cold starts: only one instance applies migrations at a time.
  await d.privileged.query('select pg_advisory_lock(727001)');
  try { await migrateLocked(d); } finally { await d.privileged.query('select pg_advisory_unlock(727001)'); }
}

async function migrateLocked(d: Driver) {
  await d.privileged.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await d.privileged.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sqlText = fs.readFileSync(path.join(dir, f), 'utf8');
    await d.script(`begin;\n${sqlText}\ncommit;`);
    await d.privileged.query('insert into schema_migrations(name) values ($1)', [f]);
  }
  // The BackEnd shows applied migrations; the restricted application role may read (only) that list.
  await d.privileged.query('grant select on schema_migrations to app_user');
}

function driver() {
  return (g.__ws ??= createDriver());
}

/** Unrestricted access (migrations, seeding, pre-authentication lookups). Never expose to request-scoped feature code. */
export async function privileged(): Promise<Q> {
  return (await driver()).privileged;
}

/**
 * Run `fn` inside a transaction bound to one tenant. The transaction drops to the non-owner role
 * `app_user` and sets `app.org_id`, so PostgreSQL row-level security enforces isolation even if
 * application code forgets a WHERE clause.
 */
export async function withTenant<T>(orgId: string, fn: (q: Q) => Promise<T>, userId?: string | null): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error('invalid tenant id');
  return (await driver()).tx(async (q) => {
    await q.query("select set_config('role', 'app_user', true), set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [orgId, userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : '']);
    return fn(q);
  });
}

export async function ensureDatabase() {
  await driver();
}

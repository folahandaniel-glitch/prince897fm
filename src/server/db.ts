import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROLES } from '../domain/policy';
import { normalizeDbUrl } from './dbcheck';

/** Minimal driver-neutral query surface. Embedded Postgres (PGlite) in dev/test, `postgres` in production. */
export interface Q {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver {
  privileged: Q;
  /** One transaction that holds the migration lock (transaction-level, so it is safe behind poolers). `run` executes multi-statement SQL. */
  migrateTx(fn: (run: (sql: string) => Promise<void>, q: Q) => Promise<void>): Promise<void>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

/**
 * Optional DB_SCHEMA keeps every WorkSuite table in its own Postgres schema, so a database shared with another application is never touched.
 * The search path is set per transaction (not as a connection option) so it also works behind transaction-mode poolers.
 */
const SCHEMA = (() => {
  const s = process.env.DB_SCHEMA?.trim();
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(s)) throw new Error('DB_SCHEMA may only use lowercase letters, digits and underscores.');
  return s;
})();
const PATH_SQL = SCHEMA ? `select set_config('search_path', '"${SCHEMA}", public', true)` : null;

const g = globalThis as unknown as { __ws?: Promise<Driver> };

async function createDriver(): Promise<Driver> {
  const raw = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || process.env.POSTGRES_PRISMA_URL?.trim(); // Vercel's database integrations set POSTGRES_URL
  const url = raw ? normalizeDbUrl(raw) : undefined;
  let driver: Driver;
  if (url) {
    const { default: postgres } = await import('postgres');
    // prepare:false keeps this compatible with transaction-mode poolers (Neon, Supabase, PgBouncer) used on serverless hosts.
    const sql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX) || 5, prepare: false, idle_timeout: 20, connect_timeout: 20, onnotice: () => {},
      // The application passes JSON as already-serialised text (value::jsonb). The driver would otherwise encode that string a second time and store a JSON string instead of an object.
      types: { json: { to: 114, from: [114, 3802], serialize: (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) } },
    });
    driver = {
      // With a dedicated schema every statement runs in a short transaction that first sets the search path.
      privileged: { query: async (s, p) => (PATH_SQL ? await sql.begin(async (t) => { await t.unsafe(PATH_SQL); return t.unsafe(s, p as any[]); }) : await sql.unsafe(s, p as any[])) as any },
      migrateTx: async (fn) => {
        await sql.begin(async (t) => {
          await t.unsafe('select pg_advisory_xact_lock(727001)'); // released automatically when this transaction ends
          if (PATH_SQL) await t.unsafe(PATH_SQL);
          await fn(async (text) => { await t.unsafe(text); }, { query: async (s, p) => (await t.unsafe(s, p as any[])) as any });
        });
      },
      tx: (fn) => sql.begin(async (t) => { if (PATH_SQL) await t.unsafe(PATH_SQL); return fn({ query: async (s, p) => (await t.unsafe(s, p as any[])) as any }); }) as any,
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
    await db.exec("set timezone to 'UTC'"); // the application's calendar day is UTC; keep the embedded database consistent on any machine
    if (SCHEMA) { await db.exec(`create schema if not exists "${SCHEMA}"; set search_path to "${SCHEMA}", public`); }
    driver = {
      privileged: { query: async (s, p) => (await db.query(s, p as any[])).rows as any },
      migrateTx: async (fn) => {
        await db.transaction(async (t) => { await fn(async (text) => { await t.exec(text); }, { query: async (s, p) => (await t.query(s, p as any[])).rows as any }); });
      },
      tx: (fn) => db.transaction(async (t) => fn({ query: async (s, p) => (await t.query(s, p as any[])).rows as any })),
    };
  }
  await migrate(driver);
  return driver;
}

/** Applies pending migrations, all inside one transaction that holds the lock: a failure leaves the database exactly as it was. */
async function migrate(d: Driver) {
  await d.migrateTx(async (run, q) => {
    if (SCHEMA) await run(`create schema if not exists "${SCHEMA}"`);
    // Never install into a database that belongs to another application.
    const first = (await q.query<{ m: string | null }>(`select to_regclass('schema_migrations')::text as m`))[0]?.m;
    if (!first && !SCHEMA) {
      const foreign = (await q.query<{ t: string | null }>(`select coalesce(to_regclass('users')::text, to_regclass('organizations')::text, to_regclass('sessions')::text) as t`))[0]?.t;
      if (foreign) throw new Error('This database already contains tables from another application (' + foreign + '). WorkSuite will not touch it. Use a separate database, or set DB_SCHEMA=worksuite to keep WorkSuite in its own schema.');
    }
    await run('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const dir = path.join(process.cwd(), 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await q.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      let sqlText = fs.readFileSync(path.join(dir, f), 'utf8');
      if (SCHEMA) sqlText = sqlText.replace(/schema public/g, `schema "${SCHEMA}"`).replace(/search_path = public/g, `search_path = "${SCHEMA}", public`);
      try {
        await run(sqlText);
        await q.query('insert into schema_migrations(name) values ($1)', [f]);
      } catch (e) {
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    // One-off: bring existing organisations' Administrator role up to the full set of tenant permissions (added to, never reduced).
    const MARK = 'code:sync-admin-role-1';
    if (!done.has(MARK)) {
      await q.query(`update roles set permissions = (select array_agg(distinct p) from unnest(permissions || $1::text[]) p) where is_system and key = 'tenant_admin'`, [SYSTEM_ROLES.find((r) => r.key === 'tenant_admin')!.permissions]);
      await q.query('insert into schema_migrations(name) values ($1)', [MARK]);
    }
    // The BackEnd shows applied migrations; the restricted application role may read (only) that list.
    await run('grant select on schema_migrations to app_user');
    // On Postgres 16+ the role that creates app_user does not automatically get the right to switch to it. Grant it (ignored when already allowed).
    await run(`do $$ begin execute 'grant app_user to current_user'; exception when others then null; end $$`);
  });
}

function driver() {
  const p = (g.__ws ??= createDriver());
  // A failed start must not be remembered: the next request tries again (for example after an environment variable is corrected).
  p.catch(() => { if (g.__ws === p) g.__ws = undefined; });
  return p;
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
    await q.query("select set_config('role', 'app_user', true), set_config('TimeZone', 'UTC', true), set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [orgId, userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : '']);
    return fn(q);
  });
}

export async function ensureDatabase() {
  await driver();
}

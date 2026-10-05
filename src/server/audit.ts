import crypto from 'node:crypto';
import type { Q } from './db';

export interface AuditInput {
  orgId: string;
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function auditHash(prev: string | null, row: Record<string, unknown>): string {
  return crypto.createHash('sha256').update((prev ?? '') + canonical(row)).digest('hex');
}

/**
 * Append an audit event inside the caller's transaction (same commit as the change itself).
 * Events form a per-tenant hash chain so deletion or alteration is detectable.
 */
const norm = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

export async function audit(q: Q, e: AuditInput): Promise<void> {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`audit:${e.orgId}`]);
  const last = await q.query<{ hash: string }>('select hash from audit_events where org_id = $1 order by id desc limit 1', [e.orgId]);
  const prev = last[0]?.hash ?? null;
  const row = {
    org: e.orgId, actor: e.actorUserId ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
    before: norm(e.before), after: norm(e.after), reason: e.reason ?? null,
  };
  const hash = auditHash(prev, row);
  await q.query(
    `insert into audit_events (org_id, actor_user_id, action, entity, entity_id, before, after, reason, ip, user_agent, prev_hash, hash)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)`,
    [e.orgId, e.actorUserId ?? null, e.action, e.entity, e.entityId ?? null,
      row.before === null ? null : JSON.stringify(row.before), row.after === null ? null : JSON.stringify(row.after),
      e.reason ?? null, e.ip ?? null, e.userAgent ?? null, prev, hash],
  );
}

/** Recompute the chain for a tenant. Returns the id of the first broken event, or null when intact. */
export async function verifyAuditChain(q: Q, orgId: string): Promise<number | null> {
  const rows = await q.query<any>('select * from audit_events where org_id = $1 order by id asc', [orgId]);
  let prev: string | null = null;
  for (const r of rows) {
    const row = {
      org: r.org_id, actor: r.actor_user_id ?? null, action: r.action, entity: r.entity, entityId: r.entity_id ?? null,
      before: r.before ?? null, after: r.after ?? null, reason: r.reason ?? null,
    };
    if (r.prev_hash !== prev || auditHash(prev, row) !== r.hash) return Number(r.id);
    prev = r.hash;
  }
  return null;
}

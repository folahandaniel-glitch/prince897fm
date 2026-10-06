import { mapsUrl, parseCoordinates } from '../domain/geo';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';

const num = (v: unknown) => (v == null ? null : Number(v));

export async function listBranches(c: Ctx) {
  need(c, 'structure:manage');
  const rows = await c.q.query<any>(`select b.id, b.name, b.code, b.region, b.address, b.phone, b.latitude, b.longitude, b.radius_m, b.is_headquarters, b.archived_at,
      (select count(*)::int from assignments a where a.branch_id = b.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)) as staff
    from branches b order by b.is_headquarters desc, b.sort_order, b.name`);
  return rows.map((r) => ({ ...r, lat: num(r.latitude), lng: num(r.longitude), radius: r.radius_m as number, map: r.latitude != null ? mapsUrl(Number(r.latitude), Number(r.longitude)) : null }));
}

export interface BranchInput { id?: string; name: string; code?: string; region?: string; address?: string; phone?: string; coordinates?: string; radiusM?: number; headquarters?: boolean }

/** Creates or edits a branch. When it has coordinates a matching geofenced workplace is created/updated so attendance checks use them. */
export async function saveBranch(c: Ctx, i: BranchInput) {
  need(c, 'structure:manage');
  const name = i.name.trim();
  if (name.length < 2 || name.length > 80) throw new UserError('Enter a branch name between 2 and 80 characters.');
  const radius = i.radiusM ?? 150;
  if (!(Number.isInteger(radius) && radius >= 20 && radius <= 5000)) throw new UserError('The radius must be a whole number of metres between 20 and 5000.');
  let lat: number | null = null, lng: number | null = null;
  if (i.coordinates?.trim()) {
    const p = parseCoordinates(i.coordinates);
    if ('error' in p) throw new UserError(p.error);
    lat = p.lat; lng = p.lng;
  }
  if ((await c.q.query('select 1 from branches where lower(name) = lower($1) and archived_at is null and id is distinct from $2', [name, i.id ?? null]))[0]) throw new UserError(`A branch named "${name}" already exists.`);
  let id = i.id;
  const before = id ? (await c.q.query<any>('select name, latitude, longitude, radius_m from branches where id = $1', [id]))[0] : null;
  if (id && !before) throw new UserError('Branch not found.');
  if (i.headquarters) await c.q.query('update branches set is_headquarters = false where is_headquarters');
  if (id) {
    await c.q.query('update branches set name=$2, code=$3, region=$4, address=$5, phone=$6, latitude=$7, longitude=$8, radius_m=$9, is_headquarters=$10 where id=$1',
      [id, name, i.code?.trim() || null, i.region?.trim() || null, i.address?.trim() || null, i.phone?.trim() || null, lat, lng, radius, !!i.headquarters]);
  } else {
    id = (await c.q.query<{ id: string }>('insert into branches (org_id, name, code, region, address, phone, latitude, longitude, radius_m, is_headquarters) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
      [c.orgId, name, i.code?.trim() || null, i.region?.trim() || null, i.address?.trim() || null, i.phone?.trim() || null, lat, lng, radius, !!i.headquarters]))[0].id;
  }
  if (lat != null && lng != null) {
    const kind = i.headquarters ? 'headquarters' : 'branch';
    const wp = (await c.q.query<{ id: string }>(`select id from workplaces where branch_id = $1 and kind in ('headquarters','branch') order by created_at limit 1`, [id]))[0];
    if (wp) await c.q.query('update workplaces set name=$2, kind=$3, address=$4, latitude=$5, longitude=$6, radius_m=$7, active=true where id=$1', [wp.id, name, kind, i.address?.trim() || null, lat, lng, radius]);
    else await c.q.query(`insert into workplaces (org_id, name, kind, address, latitude, longitude, radius_m, branch_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.orgId, name, kind, i.address?.trim() || null, lat, lng, radius, id]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: before ? 'branch.updated' : 'branch.created', entity: 'branch', entityId: id!, before: before ? { name: before.name, lat: num(before.latitude), lng: num(before.longitude), radius: before.radius_m } : null, after: { name, lat, lng, radius }, ip: c.ip, userAgent: c.userAgent });
  return id!;
}

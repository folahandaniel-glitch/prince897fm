import crypto from 'node:crypto';
import { hasAccess } from '../domain/builders';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';
import { roleKeys } from './builders';

const MAX = 5 * 1024 * 1024;
const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
export const CATEGORIES = ['General', 'Policy', 'Contract', 'HR', 'Finance', 'Legal', 'Engineering', 'Licence & compliance', 'Training'];

function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return { mime: 'application/zip', ext: 'zip' }; // docx/xlsx/pptx are zip containers
  return null;
}
const OOXML = (name: string) => /\.(docx|xlsx|pptx)$/i.test(name);

async function myDept(q: Q, userId: string) {
  return (await q.query<{ department_id: string | null }>(`select a.department_id from employees e join assignments a on a.employee_id = e.id and ${CUR} where e.user_id = $1`, [userId]))[0]?.department_id ?? null;
}
const supers = (c: Ctx) => c.subject.grants.some((g) => g.permissions.includes('*'));

export async function canOpen(c: Ctx, d: { roles: string[]; department_ids: string[] | null; created_by: string; sensitivity: string }): Promise<boolean> {
  if (supers(c) || d.created_by === c.userId || c.subject.grants.some((g) => g.permissions.includes('doc:manage'))) return true;
  if (!c.subject.grants.some((g) => g.permissions.includes('doc:view'))) return false;
  if (!hasAccess(d.roles, roleKeys(c))) return false;
  if (d.department_ids && d.department_ids.length) { const dep = await myDept(c.q, c.userId); if (!dep || !d.department_ids.includes(dep)) return false; }
  return true;
}

export async function uploadDocument(c: Ctx, i: { title: string; category: string; description?: string; sensitivity: string; roles: string[]; departmentIds?: string[]; expiresOn?: string; filename: string; data: Buffer }) {
  need(c, 'doc:upload');
  if (i.title.trim().length < 2) throw new UserError('Give the document a title.');
  if (!['public', 'internal', 'confidential'].includes(i.sensitivity)) throw new UserError('Choose a sensitivity.');
  if (i.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn)) throw new UserError('Enter a valid expiry date.');
  const file = checkFile(i.filename, i.data);
  const r = await c.q.query<{ id: string }>(`insert into documents (org_id, title, category, description, sensitivity, roles, department_ids, expires_on, created_by) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) returning id`,
    [c.orgId, i.title.trim(), i.category || 'General', i.description || null, i.sensitivity, JSON.stringify(i.roles.length ? i.roles : ['*']), i.departmentIds?.length ? i.departmentIds : null, i.expiresOn || null, c.userId]);
  await c.q.query(`insert into document_versions (org_id, document_id, version, filename, mime, size_bytes, sha256, data, uploaded_by) values ($1,$2,1,$3,$4,$5,$6,$7,$8)`, [c.orgId, r[0].id, file.name, file.mime, i.data.length, sha(i.data), i.data, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'document.uploaded', entity: 'document', entityId: r[0].id, after: { title: i.title, sensitivity: i.sensitivity, bytes: i.data.length }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
function checkFile(filename: string, data: Buffer) {
  if (data.length === 0 || data.length > MAX) throw new UserError('Files must be between 1 byte and 5 MB.');
  const kind = sniff(data); // trust the bytes, not the file name
  if (!kind || (kind.ext === 'zip' && !OOXML(filename))) throw new UserError('Only PDF, PNG, JPEG, Word, Excel and PowerPoint files are accepted.');
  const name = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `document.${kind.ext}`;
  const mime = kind.ext === 'zip' ? (/\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : /\.xlsx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation') : kind.mime;
  return { name, mime };
}

export async function addVersion(c: Ctx, id: string, filename: string, data: Buffer, note: string) {
  const d = (await c.q.query<any>('select * from documents where id = $1 and archived_at is null for update', [id]))[0];
  if (!d) throw new UserError('Document not found.');
  if (!(d.created_by === c.userId || c.subject.grants.some((g) => g.permissions.includes('doc:manage') || g.permissions.includes('*')))) throw new UserError('Only the owner or a document manager can add a new version.');
  const file = checkFile(filename, data);
  const v = d.current_version + 1;
  await c.q.query(`insert into document_versions (org_id, document_id, version, filename, mime, size_bytes, sha256, data, note, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.orgId, id, v, file.name, file.mime, data.length, sha(data), data, note.trim() || null, c.userId]);
  await c.q.query('update documents set current_version = $2 where id = $1', [id, v]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'document.version_added', entity: 'document', entityId: id, after: { version: v }, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
}

export async function listDocuments(c: Ctx, f: { q?: string; category?: string } = {}) {
  need(c, 'doc:view');
  const where = ['d.archived_at is null']; const p: unknown[] = [];
  if (f.category) { p.push(f.category); where.push(`d.category = $${p.length}`); }
  if (f.q) { p.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(d.title) like $${p.length} or lower(coalesce(d.description,'')) like $${p.length})`); }
  const rows = await c.q.query<any>(`select d.*, d.expires_on::text as expires, u.email as owner, v.filename, v.size_bytes from documents d join users u on u.id = d.created_by join document_versions v on v.document_id = d.id and v.version = d.current_version where ${where.join(' and ')} order by d.created_at desc limit 300`, p);
  const out = [];
  for (const r of rows) if (await canOpen(c, r)) out.push(r);
  return out;
}

export async function getDocument(c: Ctx, id: string) {
  const d = (await c.q.query<any>(`select d.*, d.expires_on::text as expires, u.email as owner from documents d join users u on u.id = d.created_by where d.id = $1 and d.archived_at is null`, [id]))[0];
  if (!d) return null;
  if (!(await canOpen(c, d))) need(c, 'doc:manage'); // forbidden unless a manager
  const versions = await c.q.query<any>('select version, filename, size_bytes, sha256, note, created_at, (select email from users where id = uploaded_by) as by from document_versions where document_id = $1 order by version desc', [id]);
  return { d, versions, canManage: d.created_by === c.userId || c.subject.grants.some((g) => g.permissions.includes('doc:manage') || g.permissions.includes('*')) };
}

export async function downloadVersion(c: Ctx, id: string, version?: number) {
  const d = (await c.q.query<any>('select * from documents where id = $1 and archived_at is null', [id]))[0];
  if (!d) return null;
  if (!(await canOpen(c, d))) need(c, 'doc:manage');
  const v = (await c.q.query<any>('select * from document_versions where document_id = $1 and version = $2', [id, version ?? d.current_version]))[0];
  if (!v) return null;
  if (sha(v.data) !== v.sha256) throw new UserError('Integrity check failed: this file does not match its recorded fingerprint.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'document.downloaded', entity: 'document', entityId: id, after: { version: v.version, sensitivity: d.sensitivity }, ip: c.ip, userAgent: c.userAgent });
  return { filename: v.filename as string, mime: v.mime as string, data: v.data as Buffer };
}

export async function archiveDocument(c: Ctx, id: string, reason: string) {
  const d = (await c.q.query<any>('select * from documents where id = $1', [id]))[0];
  if (!d) throw new UserError('Document not found.');
  if (!(d.created_by === c.userId || c.subject.grants.some((g) => g.permissions.includes('doc:manage') || g.permissions.includes('*')))) throw new UserError('Only the owner or a document manager can archive this.');
  if (reason.trim().length < 5) throw new UserError('Give a reason.');
  await c.q.query('update documents set archived_at = now() where id = $1', [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'document.archived', entity: 'document', entityId: id, reason, ip: c.ip, userAgent: c.userAgent });
}

/** Expiry watch: tell the owner (and document managers) 30 days before and when a document has expired. Each notice is sent once. */
export async function expiryAlerts(q: Q, orgId: string): Promise<number> {
  const rows = await q.query<any>(`select id, title, created_by, expires_on::text as exp, (expires_on < current_date) as expired from documents where archived_at is null and expires_on is not null and expires_on <= current_date + 30`);
  const mgrs = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.permissions && array['doc:manage'] and r.key <> 'super_admin' limit 10`);
  let n = 0;
  for (const d of rows) for (const u of new Set([d.created_by, ...mgrs.map((m) => m.user_id)])) {
    const key = `doc:${d.id}:${d.expired ? 'expired' : 'soon'}`;
    const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, priority, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
      [orgId, u, d.expired ? `Document expired: ${d.title}` : `Document expires soon: ${d.title}`, `Expiry date ${d.exp}. Upload a renewed version.`, `/documents/${d.id}`, d.expired ? 'high' : 'normal', key]);
    if (x[0]) n++;
  }
  void notify;
  return n;
}

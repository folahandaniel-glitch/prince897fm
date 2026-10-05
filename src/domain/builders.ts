/**
 * Pure logic for the no-code builders: field definitions, record validation, workflow transitions and automation conditions.
 * Nothing here evaluates code from configuration: conditions are plain data compared with fixed operators.
 */

export const FIELD_TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'select', 'multiselect', 'boolean', 'email', 'phone', 'url', 'employee', 'department'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string; label: string; type: FieldType; required: boolean; options?: string[]; defaultValue?: string;
  showInList?: boolean; searchable?: boolean; archived?: boolean; help?: string;
}
export interface Transition { from: string; to: string; roles: string[] } // empty roles = anyone who can edit
export interface Access { view: string[]; create: string[]; edit: string[]; remove: string[] } // role keys, '*' = any signed-in user
export interface EntityDef {
  key: string; name: string; plural: string; description?: string; prefix: string;
  fields: FieldDef[]; statuses: { key: string; label: string }[]; transitions: Transition[]; access: Access;
}

export const slug = (s: string, max = 40) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);

export function validateEntity(def: EntityDef, knownRoles: Set<string>): string[] {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(def.key)) errs.push('The key must be 2-30 lowercase letters, numbers or underscores, starting with a letter.');
  if (def.name.trim().length < 2) errs.push('Give the module a name.');
  if (!/^[A-Z]{2,5}$/.test(def.prefix)) errs.push('The record number prefix must be 2 to 5 capital letters.');
  const active = def.fields.filter((f) => !f.archived);
  if (active.length === 0) errs.push('Add at least one field.');
  if (def.fields.length > 40) errs.push('A module can have at most 40 fields.');
  const seen = new Set<string>();
  for (const f of def.fields) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key)) errs.push(`Field "${f.label}" has an invalid key.`);
    if (seen.has(f.key)) errs.push(`Two fields share the key "${f.key}".`);
    seen.add(f.key);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) errs.push(`Field "${f.label}" has an unknown type.`);
    if (['select', 'multiselect'].includes(f.type) && (f.options?.length ?? 0) < 2) errs.push(`Field "${f.label}" needs at least two options.`);
  }
  if (def.statuses.length === 0) errs.push('Add at least one status.');
  const st = new Set(def.statuses.map((s) => s.key));
  if (st.size !== def.statuses.length) errs.push('Status keys must be different from each other.');
  for (const t of def.transitions) {
    if (!st.has(t.from) || !st.has(t.to)) errs.push(`A workflow step refers to an unknown status (${t.from} to ${t.to}).`);
    for (const r of t.roles) if (!knownRoles.has(r)) errs.push(`Unknown role "${r}" in the workflow.`);
  }
  for (const k of ['view', 'create', 'edit', 'remove'] as const) for (const r of def.access[k]) if (r !== '*' && !knownRoles.has(r)) errs.push(`Unknown role "${r}" in access settings.`);
  return errs;
}

export interface ValidationResult { ok: boolean; errors: Record<string, string>; data: Record<string, unknown> }

/** Validate and normalise a submitted record against its definition. Unknown keys are dropped; archived fields are ignored. */
export function validateRecord(fields: FieldDef[], input: Record<string, unknown>, opts: { partial?: boolean } = {}): ValidationResult {
  const errors: Record<string, string> = {}, data: Record<string, unknown> = {};
  for (const f of fields.filter((x) => !x.archived)) {
    const raw = input[f.key];
    const has = raw !== undefined && raw !== null && String(raw).trim() !== '';
    if (!has) {
      if (opts.partial && raw === undefined) continue;
      if (f.required) errors[f.key] = `${f.label} is required.`;
      else if (f.type === 'boolean') data[f.key] = false;
      continue;
    }
    const s = String(raw).trim();
    switch (f.type) {
      case 'text': if (s.length > 300) errors[f.key] = `${f.label} is too long (300 characters at most).`; else data[f.key] = s; break;
      case 'longtext': if (s.length > 8000) errors[f.key] = `${f.label} is too long.`; else data[f.key] = s; break;
      case 'number': { const n = Number(s.replace(/,/g, '')); if (!Number.isFinite(n)) errors[f.key] = `${f.label} must be a number.`; else data[f.key] = n; break; }
      case 'currency': { const n = Number(s.replace(/,/g, '')); if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) errors[f.key] = `${f.label} must be an amount like 2500 or 2500.50.`; else data[f.key] = n; break; }
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) errors[f.key] = `${f.label} must be a valid date.`; else data[f.key] = s; break;
      case 'select': if (!f.options?.includes(s)) errors[f.key] = `Choose one of the listed options for ${f.label}.`; else data[f.key] = s; break;
      case 'multiselect': { const parts = Array.isArray(raw) ? (raw as unknown[]).map(String) : s.split(',').map((x) => x.trim()).filter(Boolean); if (parts.some((p) => !f.options?.includes(p))) errors[f.key] = `Choose only listed options for ${f.label}.`; else data[f.key] = parts; break; }
      case 'boolean': data[f.key] = s === 'true' || s === 'on' || s === '1'; break;
      case 'email': if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[f.key] = `${f.label} must be a valid email address.`; else data[f.key] = s.toLowerCase(); break;
      case 'phone': if (!/^[+\d][\d\s()-]{6,19}$/.test(s)) errors[f.key] = `${f.label} must be a valid phone number.`; else data[f.key] = s; break;
      case 'url': if (!/^https?:\/\/[^\s]+$/i.test(s)) errors[f.key] = `${f.label} must be a web address starting with http:// or https://.`; else data[f.key] = s; break;
      case 'employee': case 'department': if (!/^[0-9a-f-]{36}$/i.test(s)) errors[f.key] = `Choose a valid ${f.type}.`; else data[f.key] = s; break;
    }
    if (f.required && f.type === 'boolean' && !data[f.key]) errors[f.key] = `${f.label} must be ticked.`;
  }
  return { ok: Object.keys(errors).length === 0, errors, data };
}

/** A status change is allowed when a matching transition exists and the person holds one of its roles (or it lists none). */
export function canTransition(def: EntityDef, from: string, to: string, roleKeys: string[]): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: 'The record is already in that status.' };
  const t = def.transitions.find((x) => x.from === from && x.to === to);
  if (!t) return { ok: false, reason: 'This module\'s workflow does not allow that move.' };
  if (t.roles.length > 0 && !t.roles.some((r) => roleKeys.includes(r))) return { ok: false, reason: `Only ${t.roles.join(' or ')} can make this move.` };
  return { ok: true };
}

export const allowedNext = (def: EntityDef, from: string, roleKeys: string[]) => def.transitions.filter((t) => t.from === from && (t.roles.length === 0 || t.roles.some((r) => roleKeys.includes(r)))).map((t) => t.to);

export function hasAccess(allowed: string[], roleKeys: string[]): boolean {
  return allowed.includes('*') || allowed.some((r) => roleKeys.includes(r));
}

// ---- Automation conditions (data, not code) -----------------------------------------------------------------------------------------
export interface Condition { field: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'; value: string }

/** Own properties only: configuration must never reach inherited members such as constructor or __proto__. */
const own = (o: Record<string, unknown>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

export function matches(conds: Condition[], data: Record<string, unknown>, status?: string): boolean {
  return conds.every((c) => {
    const v = c.field === '_status' ? status : own(data, c.field);
    const sv = v === undefined || v === null ? '' : Array.isArray(v) ? v.join(',') : String(v);
    const nv = Number(sv), nc = Number(c.value);
    switch (c.op) {
      case 'eq': return sv === c.value;
      case 'ne': return sv !== c.value;
      case 'gt': return sv !== '' && nv > nc;
      case 'gte': return sv !== '' && nv >= nc;
      case 'lt': return sv !== '' && nv < nc;
      case 'lte': return sv !== '' && nv <= nc;
      case 'contains': return sv.toLowerCase().includes(c.value.toLowerCase());
      case 'in': return c.value.split(',').map((x) => x.trim()).includes(sv);
      default: return false;
    }
  });
}

/** Safe text interpolation for notification messages: {field} placeholders only, values are plain text. */
export const fillTemplate = (tpl: string, data: Record<string, unknown>, extra: Record<string, string> = {}) =>
  tpl.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, k: string) => { const e = own(extra, k); if (e !== undefined) return String(e); const v = own(data, k); return v === undefined || v === null ? '' : Array.isArray(v) ? (v as unknown[]).join(', ') : String(v); }).slice(0, 500);

// ---- Custom pages --------------------------------------------------------------------------------------------------------------------------
export type Block =
  | { type: 'heading'; text: string } | { type: 'text'; text: string } | { type: 'button'; label: string; href: string }
  | { type: 'image'; src: string; alt: string } | { type: 'divider' } | { type: 'callout'; text: string };

/** Only same-site paths and https links are allowed in builder content (blocks javascript: and data: URLs). */
export const safeHref = (h: string) => /^\/(?!\/)[\w\-./?=&%#]*$/.test(h) || /^https:\/\/[^\s]+$/i.test(h);

export function validateBlocks(blocks: Block[]): string[] {
  const errs: string[] = [];
  if (blocks.length > 80) errs.push('A page can have at most 80 blocks.');
  blocks.forEach((b, i) => {
    if (b.type === 'button' && !safeHref(b.href)) errs.push(`Block ${i + 1}: the link must be a path on this site (like /tasks) or an https:// address.`);
    if (b.type === 'image' && !safeHref(b.src)) errs.push(`Block ${i + 1}: the image address must be a path on this site or an https:// address.`);
    if ('text' in b && b.text.length > 5000) errs.push(`Block ${i + 1}: the text is too long.`);
  });
  return errs;
}

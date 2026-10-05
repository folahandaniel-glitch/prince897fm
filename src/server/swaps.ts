import { audit } from './audit';
import { assignRoster, cancelRoster, myEmployee } from './attendance';
import { need, today, UserError, type Ctx } from './ctx';
import { notify } from './hr';

export const SWAP_LABEL: Record<string, string> = { awaiting_colleague: 'Waiting for your colleague', awaiting_manager: 'Waiting for the manager', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

/** My upcoming rostered shifts, with any open cover request. */
export async function myShifts(c: Ctx) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  return c.q.query<any>(
    `select r.id, r.work_date::text as d, s.name, s.code, s.start_time::text as start_time, s.end_time::text as end_time,
            (select x.status from shift_swaps x where x.entry_id = r.id and x.status in ('awaiting_colleague','awaiting_manager')) as swap_status
       from roster_entries r join shifts s on s.id = r.shift_id
      where r.employee_id = $1 and r.status = 'published' and r.superseded_at is null and r.work_date >= current_date order by r.work_date, s.start_time limit 60`, [me.id]);
}

/** Colleagues in my department who could cover (names only). */
export async function colleagues(c: Ctx) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  if (!me.department_id) return [];
  return c.q.query<any>(
    `select e.id, e.full_name from employees e join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where a.department_id = $1 and e.id <> $2 and e.status = 'active' and e.hidden = false order by e.full_name`, [me.department_id, me.id]);
}

/** Upcoming shifts of same-department colleagues, for proposing an exchange (names, dates and shift names only). */
export async function colleagueShifts(c: Ctx) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  if (!me.department_id) return [];
  return c.q.query<any>(
    `select r.id, r.employee_id, e.full_name, r.work_date::text as d, s.name, s.start_time::text as start_time, s.end_time::text as end_time
       from roster_entries r join employees e on e.id = r.employee_id join shifts s on s.id = r.shift_id
       join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where a.department_id = $1 and e.id <> $2 and e.status = 'active' and e.hidden = false and r.status = 'published' and r.superseded_at is null and r.work_date >= current_date
        and not exists (select 1 from shift_swaps x where (x.entry_id = r.id or x.counter_entry_id = r.id) and x.status in ('awaiting_colleague','awaiting_manager'))
      order by r.work_date, e.full_name limit 80`, [me.department_id, me.id]);
}

/** One-way cover (targetEmployeeId) or a two-way exchange (counterEntryId: the colleague's shift you would take instead). */
export async function requestSwap(c: Ctx, i: { entryId: string; targetEmployeeId?: string; counterEntryId?: string; reason?: string }) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  const e = (await c.q.query<any>(`select r.id, r.employee_id, r.work_date::text as d, r.shift_id from roster_entries r where r.id = $1 and r.status = 'published' and r.superseded_at is null`, [i.entryId]))[0];
  if (!e || e.employee_id !== me.id) throw new UserError('You can only ask for cover on your own rostered shifts.');
  if (e.d < today()) throw new UserError('That shift is in the past.');
  let counter: any = null;
  let targetId = i.targetEmployeeId;
  if (i.counterEntryId) {
    counter = (await c.q.query<any>(`select r.id, r.employee_id, r.work_date::text as d, r.shift_id from roster_entries r where r.id = $1 and r.status = 'published' and r.superseded_at is null`, [i.counterEntryId]))[0];
    if (!counter || counter.d < today()) throw new UserError('That colleague shift is not available to exchange.');
    if ((await c.q.query(`select 1 from shift_swaps where (entry_id = $1 or counter_entry_id = $1) and status in ('awaiting_colleague','awaiting_manager')`, [counter.id]))[0]) throw new UserError('That shift already has an open request.');
    targetId = counter.employee_id;
  }
  const target = (await c.q.query<any>(`select e.id, e.user_id, e.full_name from employees e where e.id = $1 and e.status = 'active' and e.hidden = false`, [targetId ?? null]))[0];
  if (!target || target.id === me.id) throw new UserError('Choose a colleague to cover the shift.');
  if ((await c.q.query(`select 1 from shift_swaps where entry_id = $1 and status in ('awaiting_colleague','awaiting_manager')`, [i.entryId]))[0]) throw new UserError('This shift already has an open cover request.');
  const r = await c.q.query<{ id: string }>(`insert into shift_swaps (org_id, entry_id, work_date, shift_id, requester_employee_id, target_employee_id, reason, counter_entry_id, counter_date, counter_shift_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [c.orgId, i.entryId, e.d, e.shift_id, me.id, target.id, i.reason?.trim() || null, counter?.id ?? null, counter?.d ?? null, counter?.shift_id ?? null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'swap.requested', entity: 'shift_swap', entityId: r[0].id, after: { date: e.d, to: target.full_name, exchange: counter ? counter.d : null }, ip: c.ip, userAgent: c.userAgent });
  if (target.user_id) await notify(c.q, c.orgId, target.user_id, counter ? `${me.full_name} proposes a shift exchange` : `${me.full_name} asks you to cover a shift`, counter ? `${e.d} for your shift on ${counter.d}. Open` : `${e.d}. Open "My shifts" to accept or decline.`, '/roster/mine');
  return r[0].id;
}

/** Requests waiting for me (as the colleague) and requests I made. */
export async function mySwaps(c: Ctx) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  const rows = await c.q.query<any>(
    `select x.id, x.work_date::text as d, x.status, x.reason, x.decision_note, s.name as shift, s.start_time::text as start_time, s.end_time::text as end_time,
            x.requester_employee_id, x.target_employee_id, re.full_name as requester, te.full_name as target, x.counter_date::text as counter_date, cs.name as counter_shift
       from shift_swaps x join shifts s on s.id = x.shift_id left join shifts cs on cs.id = x.counter_shift_id join employees re on re.id = x.requester_employee_id join employees te on te.id = x.target_employee_id
      where (x.requester_employee_id = $1 or x.target_employee_id = $1) order by x.created_at desc limit 40`, [me.id]);
  return rows.map((r) => ({ ...r, mine: r.requester_employee_id === me.id }));
}

async function load(c: Ctx, id: string) {
  const x = (await c.q.query<any>(`select x.*, x.work_date::text as d, x.counter_date::text as counter_date, re.user_id as req_user, te.user_id as tgt_user, re.full_name as req_name, te.full_name as tgt_name from shift_swaps x join employees re on re.id = x.requester_employee_id join employees te on te.id = x.target_employee_id where x.id = $1 for update of x`, [id]))[0];
  if (!x) throw new UserError('Request not found.');
  return x;
}

export async function colleagueReply(c: Ctx, id: string, accept: boolean) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  const x = await load(c, id);
  if (x.target_employee_id !== me.id) throw new UserError('This request was not sent to you.');
  if (x.status !== 'awaiting_colleague') throw new UserError('This request is no longer waiting for you.');
  await c.q.query(`update shift_swaps set status = $2${accept ? '' : ', decided_at = now(), decision_note = $3'} where id = $1`, accept ? [id, 'awaiting_manager'] : [id, 'declined', 'Declined by colleague']);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: accept ? 'swap.accepted' : 'swap.declined_by_colleague', entity: 'shift_swap', entityId: id, ip: c.ip, userAgent: c.userAgent });
  if (x.req_user) await notify(c.q, c.orgId, x.req_user, accept ? `${x.tgt_name} agreed to cover your shift` : `${x.tgt_name} cannot cover your shift`, accept ? 'It now needs your manager\'s approval.' : undefined, '/roster/mine');
  if (accept) {
    const mgrs = await c.q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.permissions && array['roster:manage'] and r.key <> 'super_admin' limit 10`);
    for (const m of mgrs) if (m.user_id !== c.userId) await notify(c.q, c.orgId, m.user_id, 'Shift cover awaiting approval', `${x.req_name} → ${x.tgt_name}, ${x.d}`, '/roster/swaps');
  }
}

export async function cancelSwap(c: Ctx, id: string) {
  need(c, 'roster:swap');
  const me = await myEmployee(c);
  const x = await load(c, id);
  if (x.requester_employee_id !== me.id) throw new UserError('Only the person who asked can withdraw the request.');
  if (!['awaiting_colleague', 'awaiting_manager'].includes(x.status)) throw new UserError('This request is already closed.');
  await c.q.query(`update shift_swaps set status = 'cancelled', decided_at = now() where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'swap.cancelled', entity: 'shift_swap', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** Manager queue: only requests in the people's own department scope. */
export async function swapQueue(c: Ctx) {
  need(c, 'roster:manage');
  const rows = await c.q.query<any>(
    `select x.id, x.work_date::text as d, x.reason, s.name as shift, s.start_time::text as start_time, s.end_time::text as end_time, re.full_name as requester, te.full_name as target,
            x.requester_employee_id, x.target_employee_id, a.department_id, a.branch_id, x.counter_date::text as counter_date, cs.name as counter_shift
       from shift_swaps x join shifts s on s.id = x.shift_id left join shifts cs on cs.id = x.counter_shift_id join employees re on re.id = x.requester_employee_id join employees te on te.id = x.target_employee_id
       left join assignments a on a.employee_id = x.requester_employee_id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where x.status = 'awaiting_manager' order by x.work_date`);
  const { can } = await import('../domain/policy');
  return rows.filter((r) => can(c.subject, 'roster:manage', { departmentId: r.department_id, branchId: r.branch_id }).allow);
}

/** Approving moves the shift: the roster check for the colleague runs (rest hours, leave, overlaps) and the original entry is cancelled. */
export async function decideSwap(c: Ctx, id: string, approve: boolean, note: string) {
  need(c, 'roster:manage');
  const x = await load(c, id);
  if (x.status !== 'awaiting_manager') throw new UserError('This request is not waiting for a manager.');
  const mine = c.subject.employeeId;
  if (mine && (mine === x.requester_employee_id || mine === x.target_employee_id)) throw new UserError('Separation of duties: you are part of this swap, so another manager must decide.');
  const dept = (await c.q.query<any>(`select a.department_id, a.branch_id from assignments a where a.employee_id = $1 and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`, [x.requester_employee_id]))[0];
  need(c, 'roster:manage', { departmentId: dept?.department_id ?? null, branchId: dept?.branch_id ?? null });
  if (!approve) {
    if (note.trim().length < 3) throw new UserError('Give a short reason for declining.');
  } else {
    if (x.d < today()) throw new UserError('That shift date has passed.');
    if (x.counter_entry_id) {
      if (x.counter_date < today()) throw new UserError('The exchanged shift date has passed.');
      // free both shifts first so the checks see the roster as it will be; any clash aborts the whole approval
      const live = await c.q.query(`select 1 from roster_entries where id = any($1::uuid[]) and status = 'published' and superseded_at is null`, [[x.entry_id, x.counter_entry_id]]);
      if (live.length !== 2) throw new UserError('One of the shifts has changed on the roster since the request was made.');
      await cancelRoster(c, x.entry_id, `Exchanged with ${x.tgt_name} (swap approved)`);
      await cancelRoster(c, x.counter_entry_id, `Exchanged with ${x.req_name} (swap approved)`);
      const r1 = await assignRoster(c, { employeeId: x.target_employee_id, shiftId: x.shift_id, dates: [x.d] });
      const r2 = await assignRoster(c, { employeeId: x.requester_employee_id, shiftId: x.counter_shift_id, dates: [x.counter_date] });
      const blocked = [...r1.blocked, ...r2.blocked];
      if (blocked.length) throw new UserError(`Cannot approve: ${blocked.join(' ')}`);
    } else {
      const r = await assignRoster(c, { employeeId: x.target_employee_id, shiftId: x.shift_id, dates: [x.d] });
      if (r.blocked.length) throw new UserError(`Cannot approve: ${r.blocked.join(' ')}`);
      await cancelRoster(c, x.entry_id, `Covered by ${x.tgt_name} (swap approved)`);
    }
  }
  await c.q.query(`update shift_swaps set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'declined', c.userId, note.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'swap.approved' : 'swap.declined', entity: 'shift_swap', entityId: id, after: { date: x.d, from: x.req_name, to: x.tgt_name }, ip: c.ip, userAgent: c.userAgent });
  for (const u of [x.req_user, x.tgt_user]) if (u) await notify(c.q, c.orgId, u, approve ? 'Shift cover approved' : 'Shift cover declined', `${x.d}: ${x.req_name} → ${x.tgt_name}${approve ? '' : '. ' + note.trim()}`, '/roster/mine');
}

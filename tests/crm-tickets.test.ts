import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { addContact, createAccount, createOpportunity, followUpsDue, getAccount, listAccounts, logActivity, moveOpportunity, pipeline, remindFollowUps } from '../src/server/crm';
import { comment, createTicket, escalateOverdue, getTicket, listCategories, listTickets, rate, setStatus, slaDue, ticketStats } from '../src/server/tickets';
import { listParties } from '../src/server/finance';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const n of ['sales', 'support', 'presenter', 'chairman', 'officer', 'head']) u[n] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${n}@prince897.example`]))[0].id;
});

describe('CRM', () => {
  let acct = '', opp = '';
  it('sales creates accounts with a contact; duplicates are refused; staff without CRM access are blocked', async () => {
    acct = await as('sales', (c) => createAccount(c, { name: 'Ibadan Cement Ltd', industry: 'Manufacturing', email: 'ads@ibadancement.example', contactName: 'Mrs Adeyemi', contactPhone: '08012345678' }));
    await expect(as('sales', (c) => createAccount(c, { name: 'ibadan cement ltd' }))).rejects.toThrow(/already exists/);
    await expect(as('presenter', (c) => createAccount(c, { name: 'Sneaky Ltd' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => listAccounts(c))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('chairman', (c) => listAccounts(c))).length).toBe(1); // executives can view
    await expect(as('chairman', (c) => createAccount(c, { name: 'Exec Made Ltd' }))).rejects.toBeInstanceOf(ForbiddenError);
    await as('sales', (c) => addContact(c, acct, { name: 'Mr Bello', title: 'Marketing Manager' }));
    expect((await as('sales', (c) => getAccount(c, acct)))!.contacts).toHaveLength(2);
  });
  it('tracks an advertising opportunity through the pipeline; losing needs a reason; winning creates a finance client', async () => {
    await as('sales', (c) => createOpportunity(c, acct, { title: 'Q4 jingle package', value: '2,400,000', expectedClose: tomorrow, campaignStart: tomorrow, campaignEnd: '2099-12-31' }));
    opp = (await as('sales', (c) => getAccount(c, acct)))!.opps[0].id;
    await expect(as('sales', (c) => createOpportunity(c, acct, { title: 'Bad dates', value: '1', campaignStart: '2030-02-01', campaignEnd: '2030-01-01' }))).rejects.toThrow(/cannot end before/);
    expect((await as('sales', (c) => pipeline(c))).openValue).toBe(2_400_000_00);
    await as('sales', (c) => moveOpportunity(c, opp, 'proposal'));
    const msg = await as('sales', (c) => moveOpportunity(c, opp, 'won'));
    expect(msg).toMatch(/available in Finance/);
    const parties = await withTenant(ids.org, (q) => listParties(q));
    expect(parties.some((p: any) => p.name === 'Ibadan Cement Ltd' && p.kind === 'client')).toBe(true);
    expect((await as('sales', (c) => getAccount(c, acct)))!.a.status).toBe('client');
    await expect(as('sales', (c) => moveOpportunity(c, opp, 'lost', 'x'))).rejects.toThrow(/already closed/);
    const second = await as('sales', async (c) => { await createOpportunity(c, acct, { title: 'Sponsorship', value: '500000' }); return (await getAccount(c, acct))!.opps.find((o: any) => o.title === 'Sponsorship').id; });
    await expect(as('sales', (c) => moveOpportunity(c, second, 'lost', ''))).rejects.toThrow(/why it was lost/);
    await as('sales', (c) => moveOpportunity(c, second, 'lost', 'Budget cut for the quarter'));
    expect((await as('sales', (c) => pipeline(c))).winRate).toBe(83); // 2.4M won vs 0.5M lost
  });
  it('follow-ups are tracked and nudged once', async () => {
    await as('sales', (c) => logActivity(c, acct, { kind: 'call', summary: 'Confirmed audio specs, call back Friday', followUpOn: yesterday }));
    expect((await as('sales', (c) => followUpsDue(c))).length).toBe(1);
    expect(await withTenant(ids.org, (q) => remindFollowUps(q, ids.org))).toBe(1);
    expect(await withTenant(ids.org, (q) => remindFollowUps(q, ids.org))).toBe(0);
    await expect(as('sales', (c) => logActivity(c, acct, { kind: 'fax', summary: 'x' }))).rejects.toThrow(/type of contact/);
  });
});

describe('support tickets', () => {
  let tid = '';
  it('anyone can raise a ticket; SLA depends on category and priority', async () => {
    const cats = await withTenant(ids.org, (q) => listCategories(q));
    const studio = cats.find((c: any) => c.name.startsWith('Studio'))!;
    const r = await as('presenter', (c) => createTicket(c, { subject: 'Studio 2 mic has no signal', description: 'The left microphone cuts out during live segments since this morning.', categoryId: studio.id, priority: 'urgent' }));
    tid = r.id;
    const t = (await as('presenter', (c) => getTicket(c, tid)))!.t;
    expect(t.number).toMatch(/^TKT-/);
    const expected = slaDue(new Date(t.created_at), 4, 'urgent');
    expect(Math.abs(new Date(t.sla_due_at).getTime() - expected.getTime())).toBeLessThan(2000); // 4h x 0.25 = 1h
    await expect(as('presenter', (c) => createTicket(c, { subject: 'x', description: 'too short' }))).rejects.toThrow();
    await expect(as('presenter', (c) => createTicket(c, { subject: 'For a client', description: 'Trying to log for an outside client here', forName: 'Someone' }))).rejects.toThrow(/Only support staff/);
  });
  it('requesters see only their own tickets and never internal notes; support sees all', async () => {
    await expect(as('officer', (c) => getTicket(c, tid))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => listTickets(c, 'all'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('support', (c) => comment(c, tid, 'Checking the XLR cable and the preamp first.', true));
    await as('support', (c) => comment(c, tid, 'We are on it. An engineer is on the way.'));
    const view = (await as('presenter', (c) => getTicket(c, tid)))!;
    expect(view.comments.map((x: any) => x.body)).toEqual(['We are on it. An engineer is on the way.']);
    expect((await as('support', (c) => getTicket(c, tid)))!.comments).toHaveLength(2);
    expect((await as('support', (c) => getTicket(c, tid)))!.t.first_response_at).toBeTruthy();
    await expect(as('presenter', (c) => comment(c, tid, 'Internal sneak', true))).rejects.toThrow(/Only support staff/);
  });
  it('support resolves and assigns; the requester is notified and can rate', async () => {
    await as('support', (c) => setStatus(c, tid, 'in_progress', u.support));
    await as('support', (c) => setStatus(c, tid, 'resolved'));
    await expect(as('presenter', (c) => rate(c, tid, 9))).rejects.toThrow(/1 to 5/);
    await as('presenter', (c) => rate(c, tid, 5));
    const n = await withTenant(ids.org, (q) => q.query<any>(`select title from notifications where user_id = $1 and title like 'TKT-%'`, [u.presenter]));
    expect(n.length).toBeGreaterThan(0);
    const st = await as('support', (c) => ticketStats(c));
    expect(Number(st.csat)).toBe(5);
    await expect(as('presenter', (c) => setStatus(c, tid, 'closed'))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('overdue tickets are escalated once', async () => {
    const t = await as('presenter', (c) => createTicket(c, { subject: 'Printer jam in admin office', description: 'The admin printer keeps jamming on every second page.' }));
    await (await privileged()).query(`update tickets set sla_due_at = now() - interval '1 hour' where id = $1`, [t.id]);
    expect(await withTenant(ids.org, (q) => escalateOverdue(q, ids.org))).toBe(1);
    expect(await withTenant(ids.org, (q) => escalateOverdue(q, ids.org))).toBe(0);
  });
});

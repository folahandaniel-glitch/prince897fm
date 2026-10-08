/**
 * KPI rules (pure). A person's monthly KPI is a weighted average of metric scores (each 0 to 100). The metrics and weights come
 * from a profile chosen by the person's department and level; weights are data and can be edited by HR and administrators.
 */
export type LevelBand = 'executive' | 'management' | 'supervisory' | 'senior' | 'junior' | 'intern';
export const LEVEL_BANDS: { key: LevelBand; label: string }[] = [
  { key: 'executive', label: 'Executive' }, { key: 'management', label: 'Management' }, { key: 'supervisory', label: 'Supervisory' },
  { key: 'senior', label: 'Senior staff' }, { key: 'junior', label: 'Junior staff' }, { key: 'intern', label: 'Intern / trainee' },
];

/** Position seniority (1 = most senior) to level band. */
export function bandOfRank(rank: number | null | undefined): LevelBand {
  const r = rank ?? 80;
  if (r <= 10) return 'executive';
  if (r <= 50) return 'management';
  if (r <= 60) return 'supervisory';
  if (r <= 70) return 'senior';
  if (r <= 85) return 'junior';
  return 'intern';
}

export type MetricSource = 'punctuality' | 'attendance' | 'task_completion' | 'task_timeliness' | 'report_submission' | 'knowledge' | 'sales_target' | 'new_clients' | 'followups' | 'ticket_sla' | 'manual';

/** 0 to 100. With a target the score is value against target (capped at 100); without one the value is already a percentage. */
export function scoreMetric(value: number | null, target?: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const v = target && target > 0 ? (value / target) * 100 : value;
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

export interface ScoredItem { key: string; name: string; weight: number; score: number | null }

/** Weighted average over the metrics that have data; metrics without data are left out and the weights re-spread. `coverage` is the share of weight that had data. */
export function composite(items: ScoredItem[]): { score: number | null; coverage: number } {
  const total = items.reduce((a, i) => a + i.weight, 0);
  const have = items.filter((i) => i.score != null);
  const w = have.reduce((a, i) => a + i.weight, 0);
  if (!w || !total) return { score: null, coverage: 0 };
  const score = have.reduce((a, i) => a + (i.score as number) * i.weight, 0) / w;
  return { score: Math.round(score * 100) / 100, coverage: Math.round((w / total) * 10000) / 100 };
}

export function ratingOf(score: number | null): { label: string; tone: 'good' | 'ok' | 'warn' | 'bad' | 'none' } {
  if (score == null) return { label: 'Not enough data', tone: 'none' };
  if (score >= 90) return { label: 'Outstanding', tone: 'good' };
  if (score >= 75) return { label: 'Exceeds expectations', tone: 'good' };
  if (score >= 60) return { label: 'Meets expectations', tone: 'ok' };
  if (score >= 40) return { label: 'Needs improvement', tone: 'warn' };
  return { label: 'Unsatisfactory', tone: 'bad' };
}

export interface ProfileRef { id: string; departmentId: string | null; levelBand: LevelBand | null; active?: boolean }

/** Most specific profile wins: department + level, then department, then level, then the organisation-wide default. */
export function pickProfile<T extends ProfileRef>(profiles: T[], departmentId: string | null, band: LevelBand): T | null {
  const live = profiles.filter((p) => p.active !== false);
  return live.find((p) => p.departmentId === departmentId && p.levelBand === band && departmentId)
    ?? live.find((p) => p.departmentId === departmentId && p.levelBand == null && departmentId)
    ?? live.find((p) => p.departmentId == null && p.levelBand === band)
    ?? live.find((p) => p.departmentId == null && p.levelBand == null)
    ?? null;
}

// ---- Standard library for a radio station -------------------------------------------------------------------------------------------------------------
export interface MetricDef { key: string; name: string; description: string; source: MetricSource; unit?: string }
export const KPI_LIBRARY: MetricDef[] = [
  { key: 'punctuality', name: 'Punctuality', description: 'Shifts started on time (no late clock-in).', source: 'punctuality' },
  { key: 'attendance', name: 'Attendance & shift coverage', description: 'Rostered shifts actually worked.', source: 'attendance' },
  { key: 'task_completion', name: 'Task completion', description: 'Assigned tasks completed.', source: 'task_completion' },
  { key: 'task_timeliness', name: 'Deadlines met', description: 'Tasks completed on or before the due date.', source: 'task_timeliness' },
  { key: 'report_submission', name: 'Reports on time', description: 'Weekly and monthly reports submitted by the deadline.', source: 'report_submission' },
  { key: 'knowledge', name: 'Product & service knowledge', description: 'Score in the monthly knowledge assessment.', source: 'knowledge' },
  { key: 'sales_target', name: 'Revenue target', description: 'Value of deals won against the monthly target.', source: 'sales_target', unit: '₦' },
  { key: 'new_clients', name: 'New clients won', description: 'New paying clients against the monthly target.', source: 'new_clients', unit: 'clients' },
  { key: 'followups', name: 'Client follow-ups on time', description: 'Client follow-ups completed by their due date.', source: 'followups' },
  { key: 'ticket_sla', name: 'Fault tickets within SLA', description: 'Support and engineering tickets resolved within the service time.', source: 'ticket_sla' },
  { key: 'content_quality', name: 'Content & programme quality', description: 'Rated by the supervisor: voice, presentation, content, compliance with the programme format.', source: 'manual' },
  { key: 'listener_engagement', name: 'Listener engagement', description: 'Rated: call-ins, social interaction, audience growth for the programme.', source: 'manual' },
  { key: 'accuracy', name: 'Accuracy & ethics', description: 'Rated: factual accuracy, balance, corrections, broadcasting-code compliance.', source: 'manual' },
  { key: 'production_quality', name: 'Production quality', description: 'Rated: audio quality, jingles and spots produced to brief.', source: 'manual' },
  { key: 'technical_reliability', name: 'Broadcast reliability', description: 'Rated: transmitter and studio uptime, quality of maintenance.', source: 'manual' },
  { key: 'campaign_delivery', name: 'Campaign delivery', description: 'Rated: advertiser campaigns scheduled, aired and reported correctly.', source: 'manual' },
  { key: 'financial_accuracy', name: 'Accuracy of records', description: 'Rated: accuracy of postings, reconciliations and reports.', source: 'manual' },
  { key: 'compliance', name: 'Compliance & records', description: 'Rated: policies, regulations and record-keeping.', source: 'manual' },
  { key: 'vigilance', name: 'Vigilance & incident handling', description: 'Rated: patrols, logs and handling of incidents.', source: 'manual' },
  { key: 'teamwork', name: 'Teamwork & conduct', description: 'Rated: cooperation, attitude, discipline record.', source: 'manual' },
  { key: 'leadership', name: 'Leadership & team results', description: 'Rated: results of the team or department, coaching, decisions.', source: 'manual' },
  { key: 'initiative', name: 'Initiative & learning', description: 'Rated: learning, new ideas, going beyond the brief.', source: 'manual' },
];

type W = [string, number][];
/** Core weights per department family (each sums to 100) for people who do the work. */
export const DEPARTMENT_CORE: { match: RegExp; label: string; weights: W; targets?: Record<string, number> }[] = [
  { match: /programme|presenter|on.?air|oap/i, label: 'Programmes', weights: [['punctuality', 15], ['attendance', 10], ['content_quality', 25], ['listener_engagement', 20], ['knowledge', 15], ['report_submission', 5], ['teamwork', 10]] },
  { match: /news|editorial|journal/i, label: 'News', weights: [['punctuality', 10], ['attendance', 10], ['accuracy', 25], ['task_timeliness', 20], ['content_quality', 15], ['knowledge', 10], ['report_submission', 5], ['teamwork', 5]] },
  { match: /production|studio|creative/i, label: 'Production', weights: [['punctuality', 10], ['attendance', 10], ['production_quality', 25], ['task_timeliness', 20], ['task_completion', 15], ['knowledge', 10], ['teamwork', 10]] },
  { match: /engineer|technical|transmit/i, label: 'Engineering', weights: [['punctuality', 10], ['attendance', 10], ['technical_reliability', 30], ['ticket_sla', 20], ['task_completion', 10], ['knowledge', 10], ['compliance', 10]] },
  { match: /advert|traffic|marketing|sales|commercial/i, label: 'Advertising & marketing', weights: [['sales_target', 30], ['new_clients', 10], ['followups', 15], ['campaign_delivery', 15], ['knowledge', 15], ['punctuality', 5], ['report_submission', 5], ['teamwork', 5]], targets: { sales_target: 2_000_000, new_clients: 3 } },
  { match: /financ|account/i, label: 'Finance', weights: [['punctuality', 10], ['attendance', 5], ['financial_accuracy', 30], ['task_timeliness', 20], ['compliance', 15], ['knowledge', 10], ['report_submission', 10]] },
  { match: /admin|hr|human|people/i, label: 'Administration & HR', weights: [['punctuality', 10], ['attendance', 10], ['task_completion', 20], ['task_timeliness', 15], ['compliance', 20], ['knowledge', 10], ['report_submission', 10], ['teamwork', 5]] },
  { match: /secur|guard/i, label: 'Security', weights: [['punctuality', 20], ['attendance', 20], ['vigilance', 25], ['compliance', 15], ['knowledge', 10], ['teamwork', 10]] },
];
export const GENERIC_CORE: W = [['punctuality', 15], ['attendance', 15], ['task_completion', 20], ['task_timeliness', 15], ['knowledge', 15], ['report_submission', 10], ['teamwork', 10]];

/** Make the weights add up to exactly 100 (rounding goes to the heaviest metric). */
export function normaliseWeights(w: W): W {
  const total = w.reduce((a, [, x]) => a + x, 0);
  if (!total) return w;
  const scaled = w.map(([k, x]) => [k, Math.round((x / total) * 10000) / 100] as [string, number]);
  const diff = Math.round((100 - scaled.reduce((a, [, x]) => a + x, 0)) * 100) / 100;
  if (diff) { let h = 0; scaled.forEach(([, x], i) => { if (x > scaled[h][1]) h = i; }); scaled[h][1] = Math.round((scaled[h][1] + diff) * 100) / 100; }
  return scaled;
}

/** The standard weights for a department family at a level: managers and executives are judged more on leadership and team results. */
export function standardWeights(core: W, band: LevelBand): W {
  const lead: Record<LevelBand, number> = { executive: 50, management: 30, supervisory: 15, senior: 0, junior: 0, intern: 0 };
  const L = lead[band];
  let base = core.map(([k, x]) => [k, x] as [string, number]);
  if (band === 'intern') base = base.filter(([k]) => !['sales_target', 'new_clients'].includes(k)).concat([['initiative', 10]]);
  const scaled = base.map(([k, x]) => [k, (x * (100 - L)) / 100] as [string, number]);
  if (L) scaled.push(['leadership', L]);
  return normaliseWeights(scaled);
}

/** Monthly target for the revenue and client metrics, scaled up for people who lead sales. */
export function standardTarget(key: string, band: LevelBand, base?: Record<string, number>): number | null {
  const b = base?.[key];
  if (b == null) return null;
  const mult: Record<LevelBand, number> = { executive: 4, management: 3, supervisory: 1.5, senior: 1.25, junior: 1, intern: 0.5 };
  return Math.round(b * mult[band]);
}

export const periodOf = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);
export function periodBounds(period: string): { from: string; to: string; next: string } {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}`, next };
}

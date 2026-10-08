-- Phase 12: KPIs, monthly knowledge assessment, attendance location modes, birthdays.

alter table employees add column birth_date date check (birth_date is null or birth_date <= current_date);

-- Where each person may clock in from. No row = on_site (inside an authorised workplace).
create table attendance_modes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  mode text not null check (mode in ('on_site','multi_branch','hybrid','remote','field','outside_broadcast')),
  remote_weekdays int[] not null default '{}' check (remote_weekdays <@ array[0,1,2,3,4,5,6]),   -- hybrid: 0 = Sunday .. 6 = Saturday
  valid_from date,
  valid_to date,                                                                                    -- temporary exemptions (outside broadcast, assignments)
  reason text,
  set_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique (employee_id),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

-- KPI library, profiles (by department and level) and results.
create table kpi_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  key text not null,
  name text not null,
  description text,
  source text not null check (source in ('punctuality','attendance','task_completion','task_timeliness','report_submission','knowledge','sales_target','new_clients','followups','ticket_sla','manual')),
  unit text not null default '%',
  active boolean not null default true,
  unique (org_id, key)
);

create table kpi_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  department_id uuid references departments(id),
  level_band text check (level_band in ('executive','management','supervisory','senior','junior','intern')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index kpi_profile_scope on kpi_profiles (org_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(level_band, ''));

create table kpi_profile_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  profile_id uuid not null references kpi_profiles(id) on delete cascade,
  metric_id uuid not null references kpi_metrics(id),
  weight numeric(5,2) not null check (weight > 0 and weight <= 100),
  target numeric(18,2),                                       -- e.g. monthly revenue target in naira, or a count; null = percentage metric
  unique (profile_id, metric_id)
);

create table kpi_manual_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  metric_id uuid not null references kpi_metrics(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  value numeric(5,2) not null check (value between 0 and 100),
  note text,
  entered_by uuid not null references users(id),
  updated_at timestamptz not null default now(),
  unique (employee_id, metric_id, period)
);

create table kpi_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  profile_id uuid references kpi_profiles(id),
  profile_name text,
  score numeric(5,2),
  rating text,
  coverage numeric(5,2),
  detail jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','final')),
  finalised_by uuid references users(id), finalised_at timestamptz,
  computed_at timestamptz not null default now(),
  unique (employee_id, period)
);
create index on kpi_results (org_id, period);

-- Monthly product and service knowledge assessment.
create table assessment_banks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 160),
  category text not null default 'mixed' check (category in ('product','service','mixed')),
  source_file text,
  question_count int not null default 0,
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table assessment_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  bank_id uuid not null references assessment_banks(id) on delete cascade,
  position int not null,
  text text not null check (length(text) between 3 and 1000),
  options jsonb not null,                                      -- [{ "key": "A", "text": "..." }]
  correct_key text not null
);
create index on assessment_questions (bank_id);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  title text not null,
  question_count int not null check (question_count between 1 and 100),
  pass_mark int not null default 70 check (pass_mark between 1 and 100),
  minutes int not null default 30 check (minutes between 5 and 240),
  opens_on date not null,
  closes_on date not null,
  bank_ids jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (closes_on >= opens_on),
  unique (org_id, period)
);

create table assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  assessment_id uuid not null references assessments(id) on delete cascade,
  employee_id uuid not null references employees(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  question_ids jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  correct int, total int,
  score_pct numeric(5,2),
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  unique (assessment_id, employee_id)
);

do $$
declare t text;
begin
  foreach t in array array['attendance_modes','kpi_metrics','kpi_profiles','kpi_profile_metrics','kpi_manual_scores','kpi_results','assessment_banks','assessment_questions','assessments','assessment_attempts']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app_user;

-- Existing organisations: add the new permissions to their system roles (roles are data).
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['kpi:view:own','assessment:take','profile:edit:own']) p) where is_system and not hidden and not ('*' = any(permissions));
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['kpi:view','kpi:rate','kpi:manage','assessment:manage']) p) where is_system and key in ('tenant_admin','hr_manager');
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['admin:control']) p) where is_system and key = 'tenant_admin';
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['kpi:view','kpi:rate']) p) where is_system and key = 'department_head';
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['kpi:view']) p) where is_system and key in ('executive','ceo');

alter table employees add column birthday_private boolean not null default false;   -- the person can hide their birthday from the staff dashboard

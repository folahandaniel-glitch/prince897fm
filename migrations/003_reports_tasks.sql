-- Phase 3: reports (templates, submissions, approval chain), tasks, notification de-duplication.

alter table notifications add column dedupe_key text;
create unique index notifications_dedupe on notifications (user_id, dedupe_key) where dedupe_key is not null;

create table report_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  cadence text not null check (cadence in ('weekly','monthly')),
  due_weekday int check (due_weekday between 0 and 6),          -- 0 = Sunday ... 5 = Friday (weekly)
  due_time time not null default '18:00',                       -- local time in the organisation's timezone
  fields jsonb not null default '[]'::jsonb,                    -- [{key,label,type:'text'|'longtext'|'number',required}]
  chain jsonb not null default '[]'::jsonb,                     -- [{kind:'supervisor'} | {kind:'role', roleKey:'...'}]
  department_ids uuid[],                                        -- null = every employee
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  template_id uuid not null references report_templates(id),
  employee_id uuid not null references employees(id),
  period_start date not null, period_end date not null,
  due_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','returned','approved','rejected')),
  answers jsonb not null default '{}'::jsonb,
  step int not null default 0,                                  -- index into the template chain currently awaiting action
  submitted_at timestamptz,
  on_time boolean,
  -- context frozen at submission: history must show who the supervisor and department were THEN
  ctx_department_id uuid, ctx_department text,
  ctx_supervisor_id uuid references employees(id), ctx_supervisor text,
  chain_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, employee_id, period_start)
);
create index on reports (org_id, status);
create index on reports (employee_id, period_start desc);

create table report_reviews (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  report_id uuid not null references reports(id),
  step int not null,
  reviewer_user_id uuid not null references users(id),
  decision text not null check (decision in ('approved','returned','rejected')),
  note text,
  created_at timestamptz not null default now()
);
create index on report_reviews (report_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  status text not null default 'active' check (status in ('active','on_hold','done','archived')),
  owner_employee_id uuid references employees(id),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid references projects(id),
  parent_id uuid references tasks(id),
  title text not null check (length(title) between 2 and 200),
  description text,
  assignee_employee_id uuid references employees(id),
  created_by uuid not null references users(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done','cancelled')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tasks (org_id, status, due_date);
create index on tasks (assignee_employee_id, status);

create table task_comments (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on task_comments (task_id);

do $$
declare t text;
begin
  foreach t in array array['report_templates','reports','report_reviews','projects','tasks','task_comments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
revoke update, delete, truncate on audit_events from app_user;
revoke update, delete on attendance_attempts from app_user;
revoke update, delete on report_reviews from app_user;       -- review decisions are evidence
revoke insert, update, delete on organizations from app_user;
revoke all on login_attempts from app_user;

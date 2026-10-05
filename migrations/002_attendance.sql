-- Phase 2: shifts, workplaces, rosters, attendance, leave.

create table shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, code text not null,
  start_time time not null, end_time time not null,          -- end <= start means the shift crosses midnight
  grace_minutes int not null default 10 check (grace_minutes between 0 and 240),
  early_window_minutes int not null default 60 check (early_window_minutes between 0 and 480),
  overtime_after_minutes int,
  department_ids uuid[],                                      -- null = any department
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, code), unique (org_id, id)
);

create table workplaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  kind text not null default 'office' check (kind in ('headquarters','branch','office','temporary','field','remote')),
  address text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  radius_m int not null default 150 check (radius_m between 20 and 5000),
  branch_id uuid references branches(id),
  valid_from date, valid_to date,                            -- temporary workplaces
  location_required boolean not null default true,           -- false for remote/field kinds
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table workplace_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  workplace_id uuid not null references workplaces(id),
  kind text not null default 'primary' check (kind in ('primary','secondary','temporary','field','remote')),
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index on workplace_assignments (employee_id, valid_from);

create table roster_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  shift_id uuid not null references shifts(id),
  work_date date not null,
  workplace_id uuid references workplaces(id),
  status text not null default 'published' check (status in ('published','cancelled')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index roster_one_active on roster_entries (employee_id, work_date, shift_id) where superseded_at is null and status = 'published';
create index on roster_entries (org_id, work_date);

create table attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  work_date date not null,
  shift_id uuid references shifts(id),
  workplace_id uuid references workplaces(id),
  clock_in_at timestamptz not null,
  clock_in_lat numeric(9,6), clock_in_lng numeric(9,6), clock_in_accuracy_m int,
  clock_in_distance_m int,
  clock_in_result text not null check (clock_in_result in ('accepted','accepted_flagged','requires_review')),
  flags text[] not null default '{}',
  late_minutes int not null default 0,
  clock_out_at timestamptz,
  clock_out_lat numeric(9,6), clock_out_lng numeric(9,6), clock_out_accuracy_m int,
  status text not null default 'open' check (status in ('open','closed','missed_clock_out','corrected')),
  device_hash text,
  idempotency_key text,
  note text,
  created_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);
-- At most one open session per employee, and one session per employee/shift/day: duplicate attendance is impossible.
create unique index attendance_one_open on attendance_sessions (employee_id) where status = 'open';
create unique index attendance_one_per_shift_day on attendance_sessions (employee_id, work_date, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid));
create unique index attendance_idem on attendance_sessions (employee_id, idempotency_key) where idempotency_key is not null;
create index on attendance_sessions (org_id, work_date);
create index on attendance_sessions (device_hash, clock_in_at) where device_hash is not null;

-- Every attempt is kept as evidence, including blocked ones.
create table attendance_attempts (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  action text not null check (action in ('clock_in','clock_out')),
  result text not null,
  reason text,
  lat numeric(9,6), lng numeric(9,6), accuracy_m int, distance_m int,
  workplace_id uuid references workplaces(id),
  device_hash text, ip text,
  created_at timestamptz not null default now()
);
create index on attendance_attempts (employee_id, created_at desc);

create table attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  work_date date not null,
  kind text not null check (kind in ('late','absent','remote','field','cannot_clock_in','alt_location','missed_clock_out','other')),
  note text not null,
  requested_time timestamptz,                                  -- for missed clock-out corrections
  session_id uuid references attendance_sessions(id),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected')),
  decided_by uuid references users(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now()
);
create index on attendance_exceptions (org_id, status, created_at);

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  annual_days numeric(5,1) not null default 0,
  paid boolean not null default true,
  requires_approval boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  leave_type_id uuid not null references leave_types(id),
  start_date date not null, end_date date not null,
  days numeric(5,1) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references users(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on leave_requests (org_id, status);
create index on leave_requests (employee_id, start_date);

do $$
declare t text;
begin
  foreach t in array array['shifts','workplaces','workplace_assignments','roster_entries','attendance_sessions','attendance_attempts','attendance_exceptions','leave_types','leave_requests']
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
revoke insert, update, delete on organizations from app_user;
revoke all on login_attempts from app_user;
-- Attempts are evidence: insert/select only.
revoke update, delete on attendance_attempts from app_user;

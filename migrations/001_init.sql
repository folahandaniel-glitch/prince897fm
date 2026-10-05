-- WorkSuite core schema (Phase 0 + Phase 1). Shared schema, tenant isolation by RLS.
create extension if not exists btree_gist;

do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  template text not null default 'blank',
  status text not null default 'active' check (status in ('active','suspended','offboarding')),
  timezone text not null default 'Africa/Lagos',
  currency text not null default 'NGN',
  locale text not null default 'en-NG',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null check (email = lower(email)),
  password_hash text not null,
  status text not null default 'active' check (status in ('active','disabled','pending')),
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, email),
  unique (org_id, id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references organizations(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  ip text, user_agent text,
  created_at timestamptz not null default now()
);

create table login_attempts (
  id bigserial primary key,
  key text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index on login_attempts (key, created_at);

-- Organisation structure ------------------------------------------------------
create table departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, code text,
  parent_id uuid references departments(id),
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create table branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, code text, region text,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create table positions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  rank_level int not null default 100,       -- lower = more senior
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

-- Access control ----------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  key text not null, name text not null,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, key), unique (org_id, id)
);
create table user_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id),
  scope_department_ids uuid[],               -- null = organisation-wide
  scope_branch_ids uuid[],
  valid_from date not null default current_date,
  valid_to date,                             -- temporary / acting authority
  granted_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- Employees -----------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid references users(id),
  employee_no text not null,
  full_name text not null,
  email text not null check (email = lower(email)),
  phone text,
  employment_type text not null default 'permanent',
  status text not null default 'active' check (status in ('active','on_leave','suspended','exited')),
  joined_on date not null default current_date,
  exited_on date,
  created_at timestamptz not null default now(),
  unique (org_id, employee_no), unique (org_id, email), unique (org_id, id)
);

-- Effective-dated assignment history (never overwritten). valid_* = business time,
-- recorded_at/superseded_at = system time (bitemporal).
create table assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  department_id uuid references departments(id),
  branch_id uuid references branches(id),
  position_id uuid references positions(id),
  supervisor_id uuid references employees(id),
  kind text not null default 'substantive' check (kind in ('substantive','acting','temporary','project')),
  valid_from date not null,
  valid_to date,                              -- null = open ended
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  reason text,
  approved_by uuid references users(id),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (
    employee_id with =, kind with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  ) where (superseded_at is null)
);
create index on assignments (org_id, employee_id, valid_from);

-- Registration: requested authority never equals actual authority.
create table registration_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null check (email = lower(email)),
  full_name text not null,
  phone text,
  password_hash text not null,
  requested_department_id uuid references departments(id),
  requested_branch_id uuid references branches(id),
  requested_position_id uuid references positions(id),
  requested_employment_type text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_reason text,
  employee_id uuid references employees(id),
  created_at timestamptz not null default now()
);
create unique index registration_pending_email on registration_requests (org_id, email) where status = 'pending';

-- Configuration (versioned, draft -> publish -> rollback) --------------------------
create table config_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('branding','terminology','navigation')),
  version int not null,
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  payload jsonb not null,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (org_id, kind, version)
);
create unique index config_one_published on config_versions (org_id, kind) where status = 'published';

-- Notifications (in-app) ---------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null references users(id) on delete cascade,
  title text not null, body text, href text,
  priority text not null default 'normal',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);

-- Audit: append-only, hash chained per tenant ---------------------------------------------
create table audit_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  actor_user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb, after jsonb,
  reason text, ip text, user_agent text,
  created_at timestamptz not null default now(),
  prev_hash text,
  hash text not null
);
create index on audit_events (org_id, id desc);

-- Row level security --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','sessions','departments','branches','positions','roles','user_roles',
    'employees','assignments','registration_requests','config_versions','notifications','audit_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  end loop;
end $$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
-- Audit trail is insert/select only for the application role.
revoke update, delete, truncate on audit_events from app_user;
-- Organisations table is readable for lookups but not writable by tenant sessions.
revoke insert, update, delete on organizations from app_user;
-- Login attempts and the pre-auth tables are only reachable through the privileged path.
revoke all on login_attempts from app_user;

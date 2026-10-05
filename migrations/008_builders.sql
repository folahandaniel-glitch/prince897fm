-- No-code builders: custom modules (entities + records), workflows, automations, public forms, dashboards, wallboards, pages.

create table custom_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,29}$'),
  name text not null, plural text not null, description text,
  prefix text not null check (prefix ~ '^[A-Z]{2,5}$'),
  fields jsonb not null default '[]'::jsonb,
  statuses jsonb not null default '[]'::jsonb,
  transitions jsonb not null default '[]'::jsonb,
  access jsonb not null default '{"view":[],"create":[],"edit":[],"remove":[]}'::jsonb,
  nav_group text not null default 'Modules',
  public_slug text,                                         -- when set, anyone can submit the form at /f/<org>/<slug>
  public_notify_role text,
  version int not null default 1,
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create unique index custom_entity_public on custom_entities (org_id, public_slug) where public_slug is not null;

create table custom_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  entity_id uuid not null references custom_entities(id),
  number text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null,
  search text not null default '',
  created_by uuid references users(id),                      -- null = public form submission
  source_ip text,
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (entity_id, number)
);
create index on custom_records (org_id, entity_id, created_at desc);
create index custom_records_search on custom_records using gin (to_tsvector('simple', search));
create index on custom_records (source_ip, created_at) where source_ip is not null;

create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  entity_id uuid not null references custom_entities(id),
  name text not null,
  trigger text not null check (trigger in ('record_created','status_changed')),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table dashboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  device text not null default 'any' check (device in ('any','desktop','mobile','tv')),
  widgets jsonb not null default '[]'::jsonb,
  roles jsonb not null default '["*"]'::jsonb,
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table wallboard_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  token_hash text not null unique,
  dashboard_id uuid not null references dashboards(id),
  refresh_seconds int not null default 60 check (refresh_seconds between 15 and 3600),
  active boolean not null default true,
  last_seen_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table custom_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title text not null,
  blocks jsonb not null default '[]'::jsonb,
  roles jsonb not null default '["*"]'::jsonb,
  published boolean not null default false,
  version int not null default 1,
  updated_by uuid references users(id), updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create table custom_page_versions (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  page_id uuid not null references custom_pages(id),
  version int not null, title text not null, blocks jsonb not null,
  saved_by uuid references users(id), created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['custom_entities','custom_records','automation_rules','dashboards','wallboard_devices','custom_pages','custom_page_versions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
revoke update, delete on custom_page_versions from app_user;
grant usage, select on all sequences in schema public to app_user;

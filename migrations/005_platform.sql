-- Platform layer: hidden Super Admin, feature flags, security columns.

alter table users add column hidden boolean not null default false;            -- invisible to everyone except the account itself
alter table users add column platform_admin boolean not null default false;    -- may create organisations from templates
alter table users add column mfa_secret_enc text;
alter table users add column mfa_enabled boolean not null default false;
alter table users add column password_changed_at timestamptz;
alter table employees add column hidden boolean not null default false;
alter table roles add column hidden boolean not null default false;

-- A hidden account (and its employee record / role) is invisible to every other user, enforced by the database.
-- `app.user_id` is set per transaction by the application.
drop policy tenant_isolation on users;
create policy tenant_isolation on users
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid and (hidden = false or id = nullif(current_setting('app.user_id', true), '')::uuid))
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

drop policy tenant_isolation on employees;
create policy tenant_isolation on employees
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid and (hidden = false or user_id = nullif(current_setting('app.user_id', true), '')::uuid))
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

drop policy tenant_isolation on roles;
create policy tenant_isolation on roles
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid
         and (hidden = false or exists (select 1 from user_roles ur where ur.role_id = roles.id and ur.user_id = nullif(current_setting('app.user_id', true), '')::uuid)))
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

create table org_features (
  org_id uuid not null references organizations(id),
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default true,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table org_features enable row level security;
alter table org_features force row level security;
create policy tenant_isolation on org_features
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on org_features to app_user;

-- Hosted Postgres often connects as a non-superuser owner: let it switch into the restricted application role.
do $$ begin execute format('grant app_user to %I', current_user); exception when others then null; end $$;

-- The application role is not the table owner, so policies apply to it without FORCE. Dropping FORCE lets the owner
-- connection (migrations, sign-in lookups, cron) work on hosted databases where the owner is not a superuser.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('alter table %I no force row level security', t.relname);
  end loop;
end $$;

alter table sessions add column mfa_pending boolean not null default false;   -- password accepted, second factor still required

-- Read-only access to recent sign-in attempts for an organisation's own administrators, without exposing the table itself.
create or replace function recent_login_attempts(prefix text) returns table (key text, success boolean, created_at timestamptz)
language sql security definer set search_path = public as $$
  select key, success, created_at from login_attempts where key like prefix || ':%' order by id desc limit 40
$$;
revoke all on function recent_login_attempts(text) from public;
grant execute on function recent_login_attempts(text) to app_user;

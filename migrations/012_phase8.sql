-- Phase 8: shift cover/swap requests.
create table shift_swaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  entry_id uuid not null references roster_entries(id),
  work_date date not null,
  shift_id uuid not null references shifts(id),
  requester_employee_id uuid not null references employees(id),
  target_employee_id uuid not null references employees(id),
  reason text,
  status text not null default 'awaiting_colleague' check (status in ('awaiting_colleague','awaiting_manager','approved','declined','cancelled')),
  decided_by uuid references users(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(),
  check (requester_employee_id <> target_employee_id)
);
create index on shift_swaps (org_id, status);
create unique index swap_one_open on shift_swaps (entry_id) where status in ('awaiting_colleague','awaiting_manager');

alter table shift_swaps enable row level security;
create policy tenant_isolation on shift_swaps
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on shift_swaps to app_user;

update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['roster:swap']) p) where is_system and not hidden and not ('*' = any(permissions));

-- Tenant logo and emblem uploads (PNG, JPEG or WebP; never SVG, which can carry scripts).
create table org_assets (
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('logo','mark')),
  mime text not null check (mime in ('image/png','image/jpeg','image/webp')),
  bytes bytea not null check (length(bytes) between 100 and 1048576),
  sha256 text not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, kind)
);
alter table org_assets enable row level security;
create policy tenant_isolation on org_assets
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on org_assets to app_user;

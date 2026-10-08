-- Phase 13: profile photos, deliverables, memos, knowledge base, salary advances, contracts, proposals and estimates.

create table user_photos (
  user_id uuid primary key references users(id) on delete cascade,
  org_id uuid not null references organizations(id),
  mime text not null default 'image/webp' check (mime = 'image/webp'),
  bytes bytea not null check (length(bytes) between 200 and 40000),
  sha256 text not null,
  updated_at timestamptz not null default now()
);

create table deliverable_defs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 160),
  description text,
  department_id uuid references departments(id),
  level_band text check (level_band in ('executive','management','supervisory','senior','junior','intern')),
  frequency text not null default 'weekly' check (frequency in ('daily','weekly','monthly','quarterly','once')),
  target_count int not null default 1 check (target_count between 1 and 1000),
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  def_id uuid not null references deliverable_defs(id),
  employee_id uuid not null references employees(id),
  period text not null,                                     -- the month it counts for, YYYY-MM
  title text not null check (length(title) between 2 and 200),
  notes text, link text,
  due_on date,
  status text not null default 'submitted' check (status in ('submitted','approved','returned')),
  submitted_at timestamptz not null default now(),
  on_time boolean,
  reviewed_by uuid references users(id), reviewed_at timestamptz, review_note text
);
create index on deliverables (org_id, status, period);
create index on deliverables (employee_id, period);

create table memos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  ref text not null,
  title text not null check (length(title) between 2 and 200),
  body text not null check (length(body) between 1 and 8000),
  roles jsonb not null default '["*"]'::jsonb,
  require_ack boolean not null default true,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);
create table memo_acks (
  memo_id uuid not null references memos(id) on delete cascade,
  user_id uuid not null references users(id),
  org_id uuid not null references organizations(id),
  acked_at timestamptz not null default now(),
  primary key (memo_id, user_id)
);

create table kb_articles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  title text not null check (length(title) between 3 and 200),
  category text not null default 'General',
  body text not null check (length(body) between 1 and 20000),
  pinned boolean not null default false,
  status text not null default 'published' check (status in ('draft','published')),
  created_by uuid references users(id), updated_by uuid references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on kb_articles (org_id, status, category);

create table salary_advances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  amount numeric(18,2) not null check (amount > 0),
  reason text not null check (length(reason) between 5 and 500),
  months int not null default 1 check (months between 1 and 6),
  status text not null default 'requested' check (status in ('requested','approved','rejected','paid','settled','cancelled')),
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id), decided_at timestamptz, decision_note text,
  paid_by uuid references users(id), paid_at timestamptz, payment_ref text
);
create unique index advance_one_open on salary_advances (employee_id) where status in ('requested','approved','paid');
create index on salary_advances (org_id, status);

create table contract_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 160),
  body text not null check (length(body) between 10 and 40000),
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  number text not null,
  account_id uuid not null references crm_accounts(id),
  template_id uuid references contract_templates(id),
  title text not null check (length(title) between 2 and 200),
  body text not null,
  value numeric(18,2) not null default 0 check (value >= 0),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft','sent','signed','expired','cancelled')),
  signed_on date, signed_by_name text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (org_id, number)
);
create index on contracts (org_id, status, ends_on);

create table fin_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('proposal','estimate')),
  number text not null,
  party_id uuid not null references fin_parties(id),
  title text not null check (length(title) between 2 and 200),
  lines jsonb not null,                                     -- [{ "description": "...", "qty": 2, "unit": "150000.00" }]
  notes text,
  vat boolean not null default false,
  subtotal numeric(18,2) not null check (subtotal > 0),
  vat_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null check (total > 0),
  valid_until date not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','converted')),
  invoice_id uuid references fin_invoices(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on fin_quotes (org_id, kind, status);

do $$
declare t text;
begin
  foreach t in array array['user_photos','deliverable_defs','deliverables','memos','memo_acks','kb_articles','salary_advances','contract_templates','contracts','fin_quotes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app_user;

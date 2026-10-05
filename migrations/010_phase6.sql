-- Phase 6: outbound messages, password reset, invoices (receivables/payables with VAT/WHT), bank statement import,
-- training & certification, public holidays.

alter table fin_journal_entries drop constraint fin_journal_entries_source_type_check;
alter table fin_journal_entries add constraint fin_journal_entries_source_type_check check (source_type in ('expense','income','transfer','manual','reversal','opening','invoice','invoice_payment'));

alter table users add column if not exists notify_email boolean not null default true;
alter table users add column if not exists phone text;

-- Outbound messages (email/SMS). Sent by a cron sweep through a provider adapter; never blocks a request.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid references users(id),
  channel text not null check (channel in ('email','sms')),
  to_addr text not null,
  subject text,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts int not null default 0,
  error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index outbox_dedupe on outbox (org_id, dedupe_key) where dedupe_key is not null;
create index outbox_pending on outbox (status, created_at) where status = 'pending';

-- Password reset tokens: only the hash is stored. Reachable by the owner connection only (no grant to app_user).
create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on password_resets (user_id);

-- Tax defaults (editable; not verified legal advice).
create table fin_settings (
  org_id uuid primary key references organizations(id),
  vat_rate numeric(5,2) not null default 7.5 check (vat_rate between 0 and 100),
  wht_rate numeric(5,2) not null default 5 check (wht_rate between 0 and 100),
  updated_at timestamptz not null default now()
);

create table fin_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('receivable','payable')),
  number text not null,
  party_id uuid not null references fin_parties(id),
  crm_account_id uuid references crm_accounts(id),
  description text not null check (length(description) between 3 and 300),
  category_account_id uuid not null references fin_accounts(id),   -- income account (receivable) or expense account (payable)
  issue_date date not null,
  due_date date not null,
  subtotal numeric(18,2) not null check (subtotal > 0),
  vat_amount numeric(18,2) not null default 0 check (vat_amount >= 0),
  total numeric(18,2) not null check (total > 0),
  status text not null default 'open' check (status in ('pending','open','paid','void')),   -- payables start 'pending' until approved
  entry_id uuid,
  approved_by uuid references users(id), approved_at timestamptz,
  created_by uuid not null references users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  check (due_date >= issue_date),
  unique (org_id, number)
);
create index on fin_invoices (org_id, kind, status, due_date);

create table fin_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  invoice_id uuid not null references fin_invoices(id),
  paid_on date not null,
  cash numeric(18,2) not null check (cash >= 0),
  wht numeric(18,2) not null default 0 check (wht >= 0),
  cash_account_id uuid not null references fin_accounts(id),
  reference text not null,
  entry_id uuid,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (cash + wht > 0)
);
create index on fin_invoice_payments (invoice_id);

-- Bank statement lines imported from CSV, matched against paid transactions and invoice payments.
create table fin_bank_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  account_id uuid not null references fin_accounts(id),
  batch text not null,
  line_date date not null,
  description text,
  reference text,
  amount numeric(18,2) not null,                         -- positive = money in, negative = money out
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  txn_id uuid references fin_transactions(id),
  payment_id uuid references fin_invoice_payments(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, account_id, line_date, amount, reference, description)
);
create index on fin_bank_lines (org_id, account_id, status);

-- Training and certification.
create table training_courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 160),
  description text,
  mandatory boolean not null default false,
  valid_months int check (valid_months is null or valid_months between 1 and 240),   -- null = never expires
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table training_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  course_id uuid not null references training_courses(id),
  status text not null default 'assigned' check (status in ('assigned','completed','failed')),
  due_on date,
  completed_on date,
  expires_on date,
  score numeric(5,2),
  certificate_ref text,
  notes text,
  assigned_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on training_records (org_id, employee_id);
create index on training_records (org_id, course_id, status);

create table public_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  holiday_date date not null,
  name text not null check (length(name) between 2 and 100),
  unique (org_id, holiday_date)
);

do $$
declare t text;
begin
  foreach t in array array['outbox','fin_settings','fin_invoices','fin_invoice_payments','fin_bank_lines','training_courses','training_records','public_holidays']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app_user;

-- Existing tenants: add the new permissions to their system roles (roles are data).
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['training:view:own']) p) where is_system and not hidden and not ('*' = any(permissions));
update roles set permissions = (select array_agg(distinct p) from unnest(permissions || array['training:manage']) p) where is_system and key in ('tenant_admin','hr_manager');

-- Every in-app notification is mirrored to the person's email (opt-out per user). Delivery happens later via the outbox sweep.
create or replace function notification_to_outbox() returns trigger language plpgsql as $$
declare u record;
begin
  select email, notify_email, status into u from users where id = new.user_id;
  if u.email is not null and u.notify_email and u.status = 'active' then
    insert into outbox (org_id, user_id, channel, to_addr, subject, body)
    values (new.org_id, new.user_id, 'email', u.email, left(new.title, 200), left(coalesce(new.body, '') || case when new.href is not null then E'

link:' || new.href else '' end, 4000));
  end if;
  return new;
end $$;
create trigger notifications_outbox after insert on notifications for each row execute function notification_to_outbox();

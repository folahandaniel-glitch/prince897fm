-- Phase 4: finance. Management accounting on an append-only double-entry ledger (not a certified statutory package).

create table fin_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  is_cash boolean not null default false,              -- cash or bank account usable for payments/receipts
  restricted boolean not null default false,           -- restricted funds are shown separately from available cash
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code), unique (org_id, id)
);

create table fin_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  year int not null, month int not null check (month between 1 and 12),
  status text not null default 'closed' check (status in ('open','closed')),
  closed_by uuid references users(id), closed_at timestamptz,
  unique (org_id, year, month)
);

create table fin_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('vendor','client')),
  name text not null, phone text, email text, bank_details text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, kind, name)
);

create table fin_approval_bands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  min_amount numeric(18,2) not null check (min_amount >= 0),
  steps jsonb not null,                                -- ordered role keys that must approve, e.g. ["finance_manager","ceo"]
  created_at timestamptz not null default now(),
  unique (org_id, min_amount)
);

create table fin_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('expense','income','transfer')),
  number text not null,
  title text not null check (length(title) between 3 and 200),
  description text,
  party_id uuid references fin_parties(id),
  category_account_id uuid not null references fin_accounts(id),   -- expense/income account, or destination for transfers
  cash_account_id uuid references fin_accounts(id),                -- receipt account (income) / source (transfer) / payment account (expense, set when paid)
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'NGN',
  txn_date date not null,
  department_id uuid references departments(id),
  branch_id uuid references branches(id),
  status text not null default 'draft' check (status in ('draft','submitted','reviewed','approved','paid','posted','reconciled','rejected','void')),
  approval_steps jsonb not null default '[]'::jsonb,               -- band chain frozen at review time
  approval_index int not null default 0,
  created_by uuid not null references users(id),
  submitted_at timestamptz,
  reviewed_by uuid references users(id), reviewed_at timestamptz,
  approved_at timestamptz,
  paid_by uuid references users(id), paid_at timestamptz, payment_ref text,
  reconciled_by uuid references users(id), reconciled_at timestamptz, statement_ref text,
  void_reason text, voided_by uuid references users(id), voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on fin_transactions (org_id, status, txn_date);
create index on fin_transactions (org_id, department_id);

-- Every decision is evidence: insert-only.
create table fin_approvals (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  txn_id uuid not null references fin_transactions(id),
  action text not null check (action in ('submitted','reviewed','approved','returned','rejected','paid','reconciled','voided')),
  step int,
  actor_user_id uuid not null references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index on fin_approvals (txn_id);

create table fin_journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  entry_no bigint not null,
  entry_date date not null,
  memo text not null,
  source_type text not null check (source_type in ('expense','income','transfer','manual','reversal','opening')),
  txn_id uuid references fin_transactions(id),
  reverses_id uuid references fin_journal_entries(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, entry_no)
);
create unique index fin_one_reversal on fin_journal_entries (reverses_id) where reverses_id is not null;

create table fin_journal_lines (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  entry_id uuid not null references fin_journal_entries(id),
  account_id uuid not null references fin_accounts(id),
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  department_id uuid references departments(id),
  branch_id uuid references branches(id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index on fin_journal_lines (entry_id);
create index on fin_journal_lines (org_id, account_id);

-- The ledger can never be unbalanced: checked at COMMIT for every entry touched.
create or replace function fin_check_entry_balanced() returns trigger language plpgsql as $$
declare diff numeric;
begin
  select coalesce(sum(debit),0) - coalesce(sum(credit),0) into diff from fin_journal_lines where entry_id = new.entry_id;
  if diff <> 0 then raise exception 'Journal entry % is not balanced (difference %)', new.entry_id, diff using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger fin_entry_balanced after insert on fin_journal_lines deferrable initially deferred for each row execute function fin_check_entry_balanced();

create table fin_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  year int not null,
  account_id uuid not null references fin_accounts(id),
  department_id uuid references departments(id),
  amount numeric(18,2) not null check (amount >= 0),
  approved_by uuid references users(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create unique index fin_budget_unique on fin_budgets (org_id, year, account_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Supporting documents, stored with a content hash so they cannot be silently swapped. Small files only (2 MB).
create table fin_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  txn_id uuid not null references fin_transactions(id),
  filename text not null, mime text not null, size_bytes int not null check (size_bytes between 1 and 2097152),
  sha256 text not null,
  data bytea not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on fin_attachments (txn_id);

do $$
declare t text;
begin
  foreach t in array array['fin_accounts','fin_periods','fin_parties','fin_approval_bands','fin_transactions','fin_approvals','fin_journal_entries','fin_journal_lines','fin_budgets','fin_attachments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app_user;

-- Immutability for the ledger and its evidence: the application role can only append.
revoke update, delete, truncate on fin_journal_entries, fin_journal_lines, fin_approvals, fin_attachments from app_user;

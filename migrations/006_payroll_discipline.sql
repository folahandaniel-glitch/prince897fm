-- Payroll (payslips, statutory deductions, fines) and Discipline (warnings, queries, rule library).

create table comp_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  basic numeric(18,2) not null check (basic >= 0),             -- monthly amounts
  housing numeric(18,2) not null default 0 check (housing >= 0),
  transport numeric(18,2) not null default 0 check (transport >= 0),
  other_allowances jsonb not null default '[]'::jsonb,         -- [{name, amount}]
  pension_enabled boolean not null default true,
  nhf_enabled boolean not null default false,
  annual_rent numeric(18,2) not null default 0,                -- for rent relief where the tax regime allows it
  tax_id text, pension_pin text, bank_name text, bank_account text,
  effective_from date not null,
  effective_to date,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  exclude using gist (employee_id with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&)
);
create index on comp_profiles (org_id, employee_id);

-- Statutory and policy parameters are DATA owned by the organisation's accountant, never hard-coded.
create table payroll_settings (
  org_id uuid primary key references organizations(id),
  tax_bands jsonb not null,                                    -- [{upTo: annual naira | null, rate: 0.15}]
  pension_employee_pct numeric(5,2) not null default 8,
  pension_employer_pct numeric(5,2) not null default 10,
  nhf_pct numeric(5,2) not null default 2.5,
  nsitf_employer_pct numeric(5,2) not null default 1,
  rent_relief_pct numeric(5,2) not null default 20,
  rent_relief_cap numeric(18,2) not null default 500000,
  max_discretionary_pct numeric(5,2) not null default 50,      -- fines/loans/other may not take more than this % of gross in one month
  regime_note text,
  verified_by text, verified_on date,                          -- who confirmed these rates against current law
  updated_by uuid references users(id), updated_at timestamptz not null default now()
);

create table fine_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('lateness','absence')),
  free_per_month int not null default 3 check (free_per_month >= 0),   -- incidents forgiven before fines apply
  amount_per_incident numeric(18,2) not null default 0 check (amount_per_incident >= 0),
  amount_per_minute numeric(18,2) not null default 0 check (amount_per_minute >= 0),
  monthly_cap numeric(18,2),
  daily_rate_pct numeric(5,2) not null default 100,            -- absence: % of one day's gross deducted per unapproved absent day
  legal_basis text not null default '',                       -- clause of the contract / handbook / agreement authorising this deduction
  active boolean not null default false,                      -- off until HR confirms the legal basis
  updated_at timestamptz not null default now(),
  unique (org_id, kind)
);

create table pay_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  employee_id uuid not null references employees(id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('fine','deduction','loan_repayment','bonus','allowance','overtime')),
  amount numeric(18,2) not null check (amount > 0),
  reason text not null,
  source_type text not null check (source_type in ('lateness','absence','discipline','manual')),
  source_ref text,
  detail jsonb not null default '[]'::jsonb,                  -- itemised lines shown on the payslip, e.g. each late date
  status text not null default 'proposed' check (status in ('proposed','approved','waived','applied','deferred')),
  proposed_by uuid references users(id),
  decided_by uuid references users(id), decided_at timestamptz, decision_note text,
  applied_run_id uuid,
  created_at timestamptz not null default now()
);
create unique index pay_adj_source on pay_adjustments (employee_id, period, source_type, coalesce(source_ref, '')) where source_type in ('lateness','absence');
create index on pay_adjustments (org_id, period, status);

create table pay_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  status text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  prepared_by uuid not null references users(id),
  approved_by uuid references users(id), approved_at timestamptz,
  paid_by uuid references users(id), paid_at timestamptz, payment_ref text,
  totals jsonb not null default '{}'::jsonb,
  accrual_entry_id uuid, payment_entry_id uuid,
  created_at timestamptz not null default now()
);
create unique index pay_run_one_active on pay_runs (org_id, period) where status <> 'cancelled';

create table payslips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null references pay_runs(id),
  employee_id uuid not null references employees(id),
  period text not null,
  gross numeric(18,2) not null, total_deductions numeric(18,2) not null, net numeric(18,2) not null,
  details jsonb not null,                                      -- full calculation, frozen at preparation time
  employee_snapshot jsonb not null,                           -- name, number, department, position, bank, tax id at that time
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index on payslips (employee_id, period desc);

create table discipline_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null, title text not null,
  category text not null,
  description text not null,
  reference text not null default '',                          -- handbook clause or legal reference (HR to complete and confirm)
  guidance text not null default '',                           -- procedure guidance shown to the person raising a case
  default_action text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table discipline_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  number text not null,
  employee_id uuid not null references employees(id),
  kind text not null check (kind in ('query','verbal_warning','written_warning','final_warning','suspension','fine','commendation')),
  rule_id uuid references discipline_rules(id),
  title text not null, facts text not null,
  incident_date date not null,
  status text not null default 'issued' check (status in ('issued','responded','decided','acknowledged','closed','withdrawn')),
  response_due timestamptz,
  employee_response text, responded_at timestamptz,
  outcome text, decision_note text, decided_by uuid references users(id), decided_at timestamptz,
  fine_amount numeric(18,2), fine_period text,
  warning_expires_on date,
  acknowledged_at timestamptz,
  basis_case_id uuid references discipline_cases(id),          -- the query this sanction follows (fair hearing)
  override_reason text,                                        -- when a sanction is recorded without a prior query
  issued_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on discipline_cases (org_id, employee_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['comp_profiles','payroll_settings','fine_policies','pay_adjustments','pay_runs','payslips','discipline_rules','discipline_cases']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
-- Payslips are frozen records: the application role can create them but never edit or delete them once published.
create or replace function payslip_freeze() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.published then raise exception 'A published payslip cannot be deleted.'; end if;
    return old;
  end if;
  if old.published and (new.gross <> old.gross or new.net <> old.net or new.details <> old.details or new.total_deductions <> old.total_deductions) then
    raise exception 'A published payslip cannot be changed.';
  end if;
  return new;
end $$;
create trigger payslip_freeze_trg before update or delete on payslips for each row execute function payslip_freeze();
grant usage, select on all sequences in schema public to app_user;

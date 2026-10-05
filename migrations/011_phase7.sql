-- Phase 7: leave carry-over and pro-rata, purchase orders.
alter table leave_types add column carry_over_max numeric(5,1) not null default 0 check (carry_over_max >= 0 and carry_over_max <= 365);
alter table leave_types add column prorate boolean not null default true;

create table fin_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  number text not null,
  vendor_id uuid not null references fin_parties(id),
  description text not null check (length(description) between 3 and 300),
  subtotal numeric(18,2) not null check (subtotal > 0),
  expected_on date,
  status text not null default 'draft' check (status in ('draft','approved','received','billed','cancelled')),
  department_id uuid references departments(id),
  created_by uuid not null references users(id),
  approved_by uuid references users(id), approved_at timestamptz,
  received_by uuid references users(id), received_at timestamptz, receipt_note text,
  invoice_id uuid references fin_invoices(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on fin_purchase_orders (org_id, status);

alter table fin_purchase_orders enable row level security;
create policy tenant_isolation on fin_purchase_orders
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on fin_purchase_orders to app_user;

-- Phase 9: partial purchase-order deliveries and bills.
alter table fin_purchase_orders drop constraint fin_purchase_orders_status_check;
alter table fin_purchase_orders add constraint fin_purchase_orders_status_check check (status in ('draft','approved','part_received','received','billed','cancelled'));
alter table fin_purchase_orders add column billed_amount numeric(18,2) not null default 0;

create table fin_po_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  po_id uuid not null references fin_purchase_orders(id),
  amount numeric(18,2) not null check (amount > 0),
  note text not null,
  received_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on fin_po_receipts (po_id);
alter table fin_po_receipts enable row level security;
create policy tenant_isolation on fin_po_receipts
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on fin_po_receipts to app_user;
-- Orders already marked received before this change: keep them billable in full.
insert into fin_po_receipts (org_id, po_id, amount, note, received_by, created_at)
  select org_id, id, subtotal, coalesce(receipt_note, 'Received'), coalesce(received_by, created_by), coalesce(received_at, now()) from fin_purchase_orders where status in ('received','billed');
update fin_purchase_orders set billed_amount = subtotal where status = 'billed';

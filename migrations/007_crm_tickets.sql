-- CRM (leads, clients, contacts, opportunities, activities) and support tickets with SLAs.

create table crm_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 160),
  kind text not null default 'company' check (kind in ('company','individual')),
  status text not null default 'lead' check (status in ('lead','prospect','client','inactive')),
  industry text, phone text, email text, address text, source text,
  owner_user_id uuid references users(id),
  fin_party_id uuid references fin_parties(id),         -- linked finance client once they become a paying client
  notes text,
  custom jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index on crm_accounts (org_id, status);

create table crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  account_id uuid not null references crm_accounts(id),
  name text not null, title text, phone text, email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index on crm_contacts (account_id);

create table crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  account_id uuid not null references crm_accounts(id),
  title text not null,
  stage text not null default 'new' check (stage in ('new','contacted','proposal','negotiation','won','lost')),
  value numeric(18,2) not null default 0 check (value >= 0),
  expected_close date,
  campaign_start date, campaign_end date,
  owner_user_id uuid references users(id),
  lost_reason text,
  closed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on crm_opportunities (org_id, stage);

create table crm_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  account_id uuid not null references crm_accounts(id),
  opportunity_id uuid references crm_opportunities(id),
  kind text not null check (kind in ('call','meeting','email','sms','visit','note')),
  summary text not null check (length(summary) between 2 and 4000),
  occurred_at timestamptz not null default now(),
  follow_up_on date,
  follow_up_done boolean not null default false,
  by_user uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on crm_activities (account_id, occurred_at desc);
create index on crm_activities (org_id, follow_up_on) where follow_up_on is not null and not follow_up_done;

create table ticket_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  sla_hours int not null default 48 check (sla_hours between 1 and 720),
  active boolean not null default true,
  unique (org_id, name)
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  number text not null,
  subject text not null check (length(subject) between 3 and 200),
  description text not null,
  category_id uuid references ticket_categories(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  requester_user_id uuid references users(id),
  requester_name text, requester_email text,
  account_id uuid references crm_accounts(id),
  assignee_user_id uuid references users(id),
  source text not null default 'staff' check (source in ('staff','crm','public')),
  sla_due_at timestamptz,
  first_response_at timestamptz, resolved_at timestamptz, escalated_at timestamptz,
  satisfaction int check (satisfaction between 1 and 5),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on tickets (org_id, status);
create index on tickets (assignee_user_id, status);

create table ticket_comments (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  ticket_id uuid not null references tickets(id) on delete cascade,
  user_id uuid references users(id),
  author_name text,
  body text not null check (length(body) between 1 and 8000),
  internal boolean not null default false,                -- internal notes are never shown to the requester
  created_at timestamptz not null default now()
);
create index on ticket_comments (ticket_id);

do $$
declare t text;
begin
  foreach t in array array['crm_accounts','crm_contacts','crm_opportunities','crm_activities','ticket_categories','tickets','ticket_comments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app_user;

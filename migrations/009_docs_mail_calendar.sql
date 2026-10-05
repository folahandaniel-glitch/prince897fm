-- Documents (versioned library with expiry), internal mail, calendar events and announcements.

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  title text not null check (length(title) between 2 and 200),
  category text not null default 'General',
  description text,
  sensitivity text not null default 'internal' check (sensitivity in ('public','internal','confidential')),
  roles jsonb not null default '["*"]'::jsonb,                 -- role keys that can open it ('*' = every signed-in staff member)
  department_ids uuid[],                                        -- optional: limit to staff currently in these departments
  expires_on date,
  current_version int not null default 1,
  created_by uuid not null references users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on documents (org_id, category);
create index on documents (org_id, expires_on) where expires_on is not null and archived_at is null;

-- Versions are append-only evidence (the file is fingerprinted and checked on every download).
create table document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  document_id uuid not null references documents(id),
  version int not null,
  filename text not null, mime text not null,
  size_bytes int not null check (size_bytes between 1 and 5242880),
  sha256 text not null,
  data bytea not null,
  note text,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table mail_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  thread_id uuid not null,
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  priority text not null default 'normal' check (priority in ('normal','high')),
  sender_user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on mail_messages (thread_id, created_at);

create table mail_recipients (
  id bigserial primary key,
  org_id uuid not null references organizations(id),
  message_id uuid not null references mail_messages(id),
  user_id uuid not null references users(id),
  kind text not null default 'to' check (kind in ('to','cc')),
  read_at timestamptz,
  folder text not null default 'inbox' check (folder in ('inbox','archive','trash')),
  unique (message_id, user_id)
);
create index on mail_recipients (user_id, folder, read_at);

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  title text not null check (length(title) between 2 and 200),
  description text, location text,
  kind text not null default 'meeting' check (kind in ('meeting','event','deadline','training','other')),
  starts_at timestamptz not null, ends_at timestamptz,
  all_day boolean not null default false,
  roles jsonb not null default '["*"]'::jsonb,
  department_ids uuid[],
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index on events (org_id, starts_at);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  title text not null check (length(title) between 2 and 160),
  body text not null check (length(body) between 1 and 5000),
  roles jsonb not null default '["*"]'::jsonb,
  pinned boolean not null default false,
  starts_on date not null default current_date,
  expires_on date,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on announcements (org_id, starts_on);

do $$
declare t text;
begin
  foreach t in array array['documents','document_versions','mail_messages','mail_recipients','events','announcements']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
revoke update, delete on document_versions from app_user;
revoke update, delete on mail_messages from app_user;      -- sent mail is a record: it can be hidden by recipients, never edited
grant usage, select on all sequences in schema public to app_user;

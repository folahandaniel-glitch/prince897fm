-- Usernames, fuller registration details, and a "Registration approver" role that can be given to any staff member.
alter table users add column username text check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
create unique index users_username on users (org_id, username) where username is not null;

alter table registration_requests add column username text check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
alter table registration_requests add column birth_date date;
create unique index registration_pending_username on registration_requests (org_id, username) where status = 'pending' and username is not null;

insert into roles (org_id, key, name, permissions, is_system)
  select o.id, 'registration_approver', 'Registration approver', array['notification:view:own','attendance:clock','leave:request','report:submit','task:create','payslip:view:own','discipline:view:own','ticket:create','doc:view','mail:use','calendar:view','training:view:own','roster:swap','kpi:view:own','assessment:take','profile:edit:own','employee:view:own','registration:review','employee:view','employee:create'], true
    from organizations o
   where not exists (select 1 from roles r where r.org_id = o.id and r.key = 'registration_approver');

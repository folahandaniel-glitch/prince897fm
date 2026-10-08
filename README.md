# WorkSuite

Universal, multi-tenant, configuration-driven enterprise platform by **Fodan Softnet Inc.** First configured tenant: **PRINCE 89.7 FM** (Ibadan).

## What is built

| Area | Scope |
|---|---|
| Foundations | Tenancy with Postgres row-level security, policy engine (RBAC + ABAC + separation of duties), hash-chained audit trail, versioned config, terminology, PWA shell, security headers |
| People | Org structure, employee master, effective-dated assignments, registration/approval, roles, notifications |
| Time & attendance | Shifts, geofenced clock-in/out, exceptions, rosters, leave |
| Reporting & executive | Weekly/monthly reports with approval chain, tasks/projects, executive command centre, global search and command palette |
| Finance | Double-entry ledger, banded approvals with SoD, payments, reconciliation, period close, budgets, CSV export |
| Payroll & payslips | Computed payslips for every staff member (own view only), printable PDF, lateness/absence fines shown as itemised deductions, approval posts to the ledger |
| Discipline | Queries, warnings (verbal/written/final), suspension, with a Labour Law rule library and fair-hearing workflow |
| CRM & support | Accounts, contacts, opportunities, activities, follow-ups; support tickets with SLA |
| Builders | Custom modules, automations, dashboards, wallboards (TV), pages, public forms, module packs, org templates, config export/import |
| Documents, mail, calendar | Versioned documents, internal mail, events, announcements |
| Finance extras | Invoices and vendor bills with VAT and withholding tax, receivables/payables ageing, bank statement CSV import with match-and-reconcile, tax position |
| Training | Courses, assignments, results with certificate expiry, mandatory-course gap report, due and expiry alerts |
| Messaging | Every in-app notice is mirrored to email (opt-out per person) through an outbox; email via Resend, SMS via Termii (optional); password reset by email |
| Leave | Public holidays (not counted as leave days), pro-rata for new joiners, capped carry-over |
| Branding | Colours, names, terminology, and logo/emblem upload, all versioned (draft, publish, rollback) |
| KPIs | Standard KPI profiles for a radio station by department (Programmes, News, Production, Engineering, Advertising & marketing, Finance, Administration & HR, Security) and by level (executive to intern). Measures come from the system (punctuality, attendance, tasks, reports, tickets, CRM revenue) or are rated by supervisors; weights are editable and must total 100; months can be finalised |
| Monthly assessment | Administrators upload Product & Service knowledge questions as Word, PDF or PowerPoint (correct answer marked with `*` in front), preview before importing, schedule the month, and see results; staff take it once, it is marked on the server and feeds their KPI |
| Clock-in locations | Default is "must be at an assigned workplace". HR and administrators can set: any branch, hybrid (chosen weekdays), remote, field duty, or a temporary outside-broadcast exception, always with a reason |
| Auto sign-out | A session left open after the rostered shift ends (plus 15 minutes) is closed at the shift end, flagged for the supervisor, and the person is signed out |
| Staff registration | Public form at `/register/<org-code>` with every detail compulsory (name, username, email, phone, date of birth, department, branch, position, employment type, password). Approved by the Administrator, HR, the Super Admin, or any staff member given the "Registration approver" role. People sign in with their username or email |
| Administrator powers | The Administrator holds every organisation permission except the Chairman's approval stages and the BackEnd, which stay with the Chairman and the Super Admin who assists them |
| Oversight | Administrators see what staff create across the front end (tasks, documents, tickets, clients, events, announcements, module records), filter by person, remove with an audited reason, and manage every account |
| Staff dashboard | KPI score and trend, birthdays and work anniversaries, who is on duty and on leave, station pulse, upcoming events, graphical marketing statistics (money shown only to people who may see CRM or finance) and income vs spending (finance only) |
| Branches & locations | BackEnd/Admin: add, edit, archive branches with address and Google coordinates (pasted from Google Maps, or "use my location"); a matching geofence is kept in sync for clock-in |
| Announcements | A rotating banner on every page (auto-advance, pause, arrows, swipe, dots); post, edit, pin, expire and remove from Announcements |
| Edit controls | Rename departments/positions, edit employee details, shifts, leave types, training courses and CRM accounts (all audited) |
| Rosters | Weekly grid, repeating rotations (e.g. 3 on / 2 off), conflict checks |
| Shift cover & exchange | Staff ask a colleague to cover a rostered shift, or to exchange shifts; colleague accepts, then the manager approves (rest-hour, leave and overlap checks run) and the roster updates |
| Procurement | Purchase orders: raise, approve, confirm receipt (three different people), convert to a vendor bill |
| Data protection | Bank account, tax id and pension PIN are encrypted at rest (AES-256-GCM, key from `APP_SECRET`); payslips keep only a masked form |
| BackEnd (`/backend`) | Super Admin console: users, roles, feature switches, security, organisations, config. The Super Admin account is hidden from the Chairman and all staff, and can assist with the Chairman's approval queue |

See `KNOWN_GAPS.md` for what is deliberately not implemented and what must be verified before real use.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `DATABASE_URL`, an embedded Postgres (PGlite) is stored in `.data/pg` and two demo tenants are created on first start
(`prince897` radio station, `gracechapel` church). Generated demo sign-in details are written to `.data/seed-credentials.txt` (git-ignored).

```bash
npm test             # 321 tests
npm run typecheck
npm run build
```

## Deploy to Vercel

1. Create a managed Postgres 15+ with point-in-time recovery (Neon, Supabase, Vercel Postgres, RDS). Use the **pooled/transaction** connection string if offered; the app disables prepared statements.
2. Import this repository in Vercel (framework: Next.js, no overrides needed).
3. Set environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Postgres connection string. Connect as the table owner; the app switches to the `app_user` role inside each transaction so RLS applies. |
   | `APP_SECRET` | Long random string (32+ chars). Encrypts MFA secrets and payroll identifiers. **Never change or lose it**: authenticators and stored bank/tax details become unreadable. Back it up in a password manager. To change it safely, see "Rotating APP_SECRET" below. |
   | `CRON_SECRET` | Long random string; Vercel sends it to the cron routes. |
   | `DEFAULT_ORG_SLUG` | Optional, e.g. `prince897`: tenant pre-filled on the sign-in page. |
   | `APP_URL` | Public address of the deployment, e.g. `https://worksuite.example.com` (used in email links). |
   | `RESEND_API_KEY`, `MAIL_FROM` | Optional. Enables email delivery (notifications, password reset). Without them messages are queued then marked skipped; in-app notices still work. |
   | `TERMII_API_KEY`, `TERMII_SENDER` | Optional. Enables SMS delivery. |
   | `DB_SCHEMA` | Optional. Set to `worksuite` if you must share a database with another application: every WorkSuite table then lives in its own schema and nothing else is touched. Needs a direct (non-pooled) or session-mode connection string for the first deploy. A separate database is simpler and safer. |
   | `SETUP_TOKEN` | You invent it: run `npm run secret` and paste the result (use a different value for each secret). | Random string (16+ chars) that unlocks the one-time `/setup` page. |
   | `SEED_DEMO` | Leave **unset** in production. |

4. Deploy. Migrations in `migrations/` apply automatically on first request (advisory-locked, recorded in `schema_migrations`).
5. Create your organisation: open `https://<your-site>/setup`, enter the `SETUP_TOKEN`, the organisation details, the Chairman's/administrator's email and (optionally) your hidden Super Admin email. The page shows one-time passwords once; sign in at `/login` with the organisation code and change the password when asked. `/setup` switches itself off as soon as an organisation exists (if you forgot the Super Admin email, `/setup` offers a one-time "Create Super Admin" form until one exists). The Super Admin signs in at `/login` like everyone else, or via the tiny **BackEnd** link under the footer, and must change the one-time password first. (Command-line alternative: `npx tsx scripts/provision.ts prince897 "PRINCE 89.7 FM" chairman@example.com radio you@example.com` with `DATABASE_URL` and `APP_SECRET` set.)

6. Cron jobs (`vercel.json`): attendance at 03:00 UTC and the reports/CRM/tickets/documents/training/outbox sweep at 04:00 UTC, once a day so the free Hobby plan accepts them. On Vercel Pro you can change the second to `0 */6 * * *`. Email is also sent right after each action, so the sweep is only a backstop.
7. Pick the Vercel function region closest to the database (for Lagos users: Europe or South Africa).

## Architecture in one page

- `src/domain`: pure logic (policy, payroll, finance, attendance, builders). No I/O.
- `src/server`: services. Every tenant query runs through `withTenant()`, which sets `app.org_id`/`app.user_id` and drops to the non-owner role so **PostgreSQL enforces isolation even if application code forgets a filter**.
- `src/app`: Next.js App Router. Pages call `page()`, mutations call `mutate()`; both resolve the session and run as that user.
- History is never overwritten: bitemporal assignments, frozen published payslips, append-only hash-chained audit.
- Money is stored in `numeric(18,2)` / kobo integers, never floats.
- Hidden Super Admin: RLS hides `hidden` users/employees/roles from everyone except the account itself.

## Branding

PRINCE 89.7 FM uses the logo and colours from princefm897.com.ng. Sources are in `public/brand`; icons are generated by `node scripts/make-assets.mjs`.

## Rotating APP_SECRET

1. Generate a new secret (32+ chars).
2. In Vercel set `APP_SECRET_PREVIOUS` to the old value and redeploy (values stay readable with either key).
3. From your computer, with `DATABASE_URL` set: `OLD_APP_SECRET=... NEW_APP_SECRET=... npx tsx scripts/rotate-secret.ts` (safe to re-run).
4. Set `APP_SECRET` to the new value, remove `APP_SECRET_PREVIOUS`, redeploy.

## Sharing a database with another project

Best: give WorkSuite its own database (Neon: a new project is free). If you really must share, set `DB_SCHEMA=worksuite`. Without it, WorkSuite refuses to install into a database that already has tables named `users`, `organizations` or `sessions`, so it can never overwrite another application's data. Note that the `app_user` database role is created once per Postgres server.

## If `/setup` shows a database error

The page lists each step (read the string, find the host, reach the server) with a tick or cross, plus a hint. Common causes:
- **Supabase direct string** (`db.<project>.supabase.co`): IPv6 only, which Vercel cannot use. Use the *Transaction pooler* string (host ends `pooler.supabase.com`).
- **Neon**: copy the string from Connect → *Pooled connection*, make sure the project is not suspended, no IP allow-list is on.
- A pasted string with quotes, spaces or `psql '…'` around it is cleaned automatically; `channel_binding` is removed and `sslmode=require` is added for you.

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
| Leave | Public holidays (not counted as leave days) |
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
npm test             # 228 tests
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
   | `APP_SECRET` | Long random string (32+ chars). Encrypts MFA secrets. Changing it invalidates enrolled authenticators. |
   | `CRON_SECRET` | Long random string; Vercel sends it to the cron routes. |
   | `DEFAULT_ORG_SLUG` | Optional, e.g. `prince897`: tenant pre-filled on the sign-in page. |
   | `APP_URL` | Public address of the deployment, e.g. `https://worksuite.example.com` (used in email links). |
   | `RESEND_API_KEY`, `MAIL_FROM` | Optional. Enables email delivery (notifications, password reset). Without them messages are queued then marked skipped; in-app notices still work. |
   | `TERMII_API_KEY`, `TERMII_SENDER` | Optional. Enables SMS delivery. |
   | `SEED_DEMO` | Leave **unset** in production. |

4. Deploy. Migrations in `migrations/` apply automatically on first request (advisory-locked, recorded in `schema_migrations`).
5. Create the first tenant and its administrators (args: code, name, admin email, template, optional hidden Super Admin email; prints one-time passwords, to be changed at first sign-in):

   ```bash
   DATABASE_URL=... APP_SECRET=... npx tsx scripts/provision.ts prince897 "PRINCE 89.7 FM" chairman@example.com radio you@example.com
   ```

6. Cron jobs (`vercel.json`): attendance daily at 03:00 UTC, reports/CRM/tickets/documents sweep every 6 hours (needs Vercel Pro; on Hobby change to daily).
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

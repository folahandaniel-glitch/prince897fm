# WorkSuite handover: PRINCE 89.7 FM

Vendor: Fodan Softnet Inc. This is the short operating guide. The README has the full technical detail and `KNOWN_GAPS.md` lists what is not built.

## Sign-in and roles
| Who | Where | Notes |
|---|---|---|
| Super Admin (hidden) | Footer link **BackEnd** on the sign-in page | Created once at `/setup` with the `SETUP_TOKEN`. Can do everything, including the Chairman's approval stages when assisting. Not visible to anyone else. |
| Administrator | Normal sign-in | Every permission except the Chairman's approvals and the BackEnd. Controls accounts, oversight and all setup. |
| Chairman, CEO, Finance, HR, Heads of Department, Sales, Support, Staff | Normal sign-in | Roles are data; adjust them in the BackEnd. |
| New staff | `/register/<org-code>` | All fields compulsory. Approved by the Administrator, HR, the Super Admin or anyone given the *Registration approver* role. |

Sign in with email **or** username. Passwords have a show/hide button. Forgotten passwords: "Forgot password" on the sign-in page (needs email set up), or an Administrator resets it under Accounts.

## First-day checklist
1. Open `/setup` once, enter the `SETUP_TOKEN` and create the Super Admin. Then **change the password** from the BackEnd.
2. BackEnd > Branches & locations: set each branch's Google coordinates (paste from Google Maps).
3. Structure: confirm departments, positions and branches.
4. Payroll settings: confirm tax bands, pension and NHF with your accountant. Set each person's pay under Payroll > People.
5. KPI: Team KPI shows the standard profile for each department and level. Review the weights with HR.
6. Deliverable Setup: list what each department must produce each month.
7. Monthly assessment: upload the Product & Service Knowledge questions (Word/PDF/PowerPoint, correct answer starts with `*`).
8. Finance setup: bank accounts, opening balance, VAT/WHT rates (confirm with your accountant), approval bands.
9. Post the first announcement and memo. Ask staff to add their profile picture (Account > Profile).

## Template menu → where it lives
| Menu | Pages |
|---|---|
| Dashboard | Dashboard |
| My Work | My Tasks, My Deliverables, Projects, Reports, My KPI, My Performance, Attendance, Late Excuses, Leave, payslips, Salary Advances |
| Team | Team Performance, Task Board, Review Deliverables, Deliverable Setup, Team KPI, Performance Flags |
| Company | Notice Board, Memos, Knowledge Base, Events & Holidays, Documents |
| HR Management | Staff HRM, Registrations, Roster, Leave requests, Payroll, Advance requests, Disciplinary, Training |
| Clients | Clients & CRM pipeline, Contracts, Contract Templates |
| Reports | Management Reports (attendance, leave, payroll, tasks; CSV), Command centre, Report compliance |
| Finance | Finance desk, Proposals & Estimates, Invoices, Payments, Expenses, Ageing, Bank, VAT & WHT, Budgets |
| Support Tickets | Support, All Tickets |

Each person only sees the menu items their role allows; modules can be switched off in the BackEnd.

## Environment variables (Vercel)
`DATABASE_URL`, `APP_SECRET` (keep a copy; losing it makes bank details unreadable), `SETUP_TOKEN`, `CRON_SECRET`, `APP_URL`, `DEFAULT_ORG_SLUG`. Optional: `RESEND_API_KEY` + `MAIL_FROM` (email), `TERMII_API_KEY` + `TERMII_SENDER` (SMS), `DB_SCHEMA`. Do not set `SEED_DEMO` in production.

## Daily jobs (Vercel Cron, already configured)
- 03:00 UTC attendance sweep: closes forgotten shifts and flags them.
- 04:00 UTC reminders: reports, follow-ups, document expiry, training, assessments, contract renewals.

## Before real use
- Change every password that was ever shared in chat or email.
- Have an accountant confirm tax settings and a lawyer confirm contract and discipline wording.
- Walk through one full month on test data: attendance, a pay run, an advance, an invoice.
- Test the sign-in, clock-in and picture upload on a real phone on site.

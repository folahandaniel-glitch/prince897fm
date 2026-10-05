# Known gaps (honest register)

## Must be verified before real use
- **Payroll statutory rates** (PAYE bands, pension, NHF, NSITF, rent relief) are seeded defaults and are **not verified**. A qualified accountant must confirm them in Payroll > Settings before any run is approved.
- **Labour Law references** in the discipline rule library are generic. HR/legal counsel must complete the exact statutory citations. A fine policy cannot be activated without a recorded legal basis.
- **Hidden Super Admin** holds `*` permissions plus the Chairman's approval role. Audit entries show an administrator actor. Decide governance and disclosure for this account with your compliance adviser.
- Production data needs a managed Postgres with point-in-time recovery and tested restores.

## Security
- The Content-Security-Policy now uses a fresh script nonce per request with `strict-dynamic` (no inline-script allowance). Styles still allow `'unsafe-inline'` (Tailwind and component style attributes). The built-in static 404 page has no nonce, so its scripts are blocked (it is plain text and still works).
- Password reset by email exists (needs RESEND_API_KEY and APP_URL). There is no email address verification at sign-up.
- Rate limiting: login and password reset are strict (database-backed); other POSTs have a best-effort per-instance limit in the middleware, not a shared edge limiter.
- Uploads are type/size/magic-byte checked but not virus scanned.
- A CI pipeline (typecheck, tests, build, dependency audit) runs on GitHub; there is still no external penetration test or DAST.
- Bank account, tax id and pension PIN are encrypted at rest; national ID numbers are not collected. Losing `APP_SECRET` makes those values unreadable (a rotation script exists: see README).
- `x-forwarded-for` is trusted for IP capture (correct on Vercel).

## Product
- Email/SMS are delivered through the outbox only when providers are configured; there is no push notification, and no per-event channel preferences beyond the email on/off switch.
- Finance: multi-currency is not built; purchase orders support partial deliveries and bills by value (no line items or quantities). VAT and WHT rates are editable defaults to be confirmed by an accountant; WorkSuite records them on the ledger but does not file returns. Vendor bills have one approval (senior approver for large bills), not the full multi-step chain of transactions. Bank import is CSV only (no live bank feeds); matching is by exact amount and nearby date.
- Leave: public holidays exist (moveable ones are entered by hand); carry-over is a single yearly cap with no expiry date.
- Training: records and certificates are tracked as data; there is no course content delivery or online assessment.
- Rosters: shift cover and two-way exchanges exist; rotating patterns are not built.
- Attendance: rotating QR and WebAuthn step-up not built; verify the HQ geofence radius on site.
- Workflow builder is data-driven but has no visual designer. Search covers staff, tasks, departments, documents, clients, tickets and finance, each through that module's own access rules.
- Wallboard TV/device testing not done.
- Tenant custom domains and logo upload UI not built.

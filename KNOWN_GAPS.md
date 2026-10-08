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
- Rosters: shift cover, two-way exchanges and repeating rotations exist; there are no minimum-coverage rules yet.
- Attendance: rotating QR and WebAuthn step-up not built; verify the HQ geofence radius on site. The automatic sign-out grace period is fixed at 15 minutes after the shift end.
- KPIs: the standard weights are a sensible starting point for a radio station, not a validated HR instrument; HR should review them. Revenue measures use deals marked won in the CRM with their close date. Training and discipline records are not yet KPI inputs.
- Monthly assessment: one attempt per person, no question-level randomised option order, no image questions. The `*` marking convention is required; unmarked files are rejected with a clear message. Scanned (image-only) PDFs contain no text and cannot be read.
- Workflow builder is data-driven but has no visual designer. Search covers staff, tasks, departments, documents, clients, tickets and finance, each through that module's own access rules.
- Wallboard TV/device testing not done.
- Tenant custom domains are not built (use Vercel's domain settings for the whole deployment). Logos and emblems can be uploaded (PNG/JPEG/WebP up to 1 MB); app-install icons still come from the generated set.
- Profile pictures: uploads are limited to 4 MB (the hosting platform caps request size); there is no in-browser cropper, the server centres on the subject automatically.
- Salary advances: one open advance per person; the repayment schedule is fixed at payment time (equal parts starting next month). An exit mid-repayment must be settled by HR in the final pay.
- Contracts: signatures are recorded as a name and date entered by staff; there is no electronic-signature service. Have a lawyer approve template wording.
- Proposals/estimates: the form takes up to 5 lines; there is no PDF download beyond the browser's Print/Save as PDF.
- Performance flags are fixed rules (listed on the page), not a configurable engine.

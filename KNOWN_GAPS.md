# Known gaps (honest register)

## Must be verified before real use
- **Payroll statutory rates** (PAYE bands, pension, NHF, NSITF, rent relief) are seeded defaults and are **not verified**. A qualified accountant must confirm them in Payroll > Settings before any run is approved.
- **Labour Law references** in the discipline rule library are generic. HR/legal counsel must complete the exact statutory citations. A fine policy cannot be activated without a recorded legal basis.
- **Hidden Super Admin** holds `*` permissions plus the Chairman's approval role. Audit entries show an administrator actor. Decide governance and disclosure for this account with your compliance adviser.
- Production data needs a managed Postgres with point-in-time recovery and tested restores.

## Security
- CSP allows `'unsafe-inline'` scripts; move to per-request nonces. 
- No password reset or email verification (needs an email provider adapter); admins issue one-time passwords.
- Rate limiting is database-backed for login only; add edge rate limiting for other endpoints.
- Uploads are type/size/magic-byte checked but not virus scanned.
- No external penetration test, SAST/DAST or CI pipeline yet.
- No field-level encryption of bank details / national IDs.
- `x-forwarded-for` is trusted for IP capture (correct on Vercel).

## Product
- Ticket and CRM notifications are in-app only (no email/SMS/push).
- Finance: bank statement import, receivables/payables ageing, purchase orders, VAT/WHT, multi-currency not built.
- Leave: public holidays, carry-over and pro-rata not modelled. Rosters: swaps and rotating patterns not built.
- Attendance: rotating QR and WebAuthn step-up not built; verify the HQ geofence radius on site.
- Workflow builder is data-driven but has no visual designer; search does not index documents.
- Wallboard TV/device testing not done. Training/certification module not built.
- Tenant custom domains and logo upload UI not built.

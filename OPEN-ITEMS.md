# Open items

Everything still open for Track2 as of 2026-10-14, after PR #7 went live. Check items off (or delete
them) as they're done. Details and procedures live in [OPS.md](OPS.md) and [PROGRESS.md](PROGRESS.md).

## 1. Vercel settings (Dzuy)
All in vercel.com → big-sea-time-tracking → Settings. **Redeploy once at the end**: env changes only
apply to new deployments.

- [x] `APP_URL=https://track2.bigseabridge.com` (Production). Done 2026-10-14.
- [ ] **`CRON_SECRET`**: Environment Variables → Add New → any long random string → **Production only**.
  Turns on recurring invoices and the 12-hour timer auto-stop (Vercel sends it to the crons in `vercel.json`).
- [ ] **Connection pool**: edit `DATABASE_URL`, change `connection_limit=1` to
  `connection_limit=5&pool_timeout=20` (don't add a second `connection_limit`).
- [ ] **Fluid Compute**: Settings → Functions → Fluid Compute → on.
- [ ] **Keep production secrets out of previews**: set `DATABASE_URL`, `DIRECT_URL` (if present),
  `AUTH_SECRET`, `INTEGRATION_ENC_KEY`, `CRON_SECRET` to **Production only**. Then add a Preview-only
  `DATABASE_URL=postgresql://preview:preview@localhost:5432/none` so preview builds still pass (preview
  pages will error; a separate test database is the fix if working previews are wanted).
- [ ] **Preview protection**: Settings → Deployment Protection → Vercel Authentication → Standard Protection.
- [ ] **Login rate limit**: Firewall → Configure → New Rule "Login rate limit": If path equals
  `/api/auth/callback/credentials` and method `POST` → Rate Limit, 60s fixed window, 10 requests, key
  IP, Deny. Publish. (May need Vercel Pro; the app also locks an account after 10 failed logins.)
- [ ] **Redeploy**: Deployments → latest Production → ⋯ → Redeploy.

## 2. Other quick items (Dzuy)
- [ ] Merge PR #8 (docs).
- [ ] **Test the claude.ai connector**: claude.ai → Settings → Connectors → Add custom connector →
  `https://track2.bigseabridge.com/api/mcp` → sign in → Allow → ask it something. Only part of the MCP
  server not yet exercised against production. If it fails, see the RLS note in OPS.md §9b.
- [ ] **Supabase backups**: the org is on Pro; confirm Point-in-Time Recovery under Database → Backups.
  Until the parked backup workflow is re-enabled, this is the only backup.
- [ ] **Google OAuth client** (OPS.md §8): Internal consent screen, redirect URIs
  `https://track2.bigseabridge.com/api/auth/callback/google` and `/api/google/drive/callback`, Drive
  API enabled with the `drive.file` scope; put `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` in Vercel.
  Turns on Google sign-in and Export → Google Drive (BugHerd #4 / #10).
- [ ] **Production data cleanup** (SQL editor script, ask Claude to generate it): delete the seeded demo
  logins (password `password123`) and the `acc_globex` test account; rename the account from
  "Big Sea (demo)" (it shows on invoices).
- [ ] **RLS on older tables**: Supabase → Advisors → Security lists tables without Row Level Security.
  Track2 connects as the table owner, so enabling it is safe and blocks Supabase's public API.

## 2b. Billing chain go-live settings (Dzuy; PR for the invoice trace)
Without these the code works, but parts of the trail stay empty. Steps in OPS.md §10–§13.
- [ ] **Database**: run the `InvoiceEvent` script (migration `20261016120000_invoice_events`) in the
  Supabase SQL editor **before** deploying the PR (the app writes trail rows on every send/payment).
- [ ] **SendGrid Event Webhook** (OPS §12a): Settings → Mail Settings → Event Webhook → URL
  `https://track2.bigseabridge.com/api/email/events`, all delivery + engagement events, **Signed Event
  Webhook on**; copy the verification key into Vercel as **`SENDGRID_WEBHOOK_PUBLIC_KEY`** (Production), redeploy.
  Until then delivered / bounced / opened / spam never reach the trail (the endpoint answers 503).
- [ ] **SendGrid tracking**: Click Tracking **off** (rewritten links look like phishing and break the
  `/i/` link), Subscription Tracking **off**; Open Tracking on.
- [ ] **Email authentication** (OPS §12b): SendGrid → Sender Authentication → authenticate `bigsea.co`
  and `cordelialabs.com` (add the 3 CNAMEs in DNS), and a DMARC record (`_dmarc` TXT, start with
  `p=none; rua=mailto:…`). This is the main protection against invoices landing in spam.
- [ ] **Stripe webhook** (OPS §11): endpoint `https://track2.bigseabridge.com/api/integrations/stripe/webhook/acc_demo`
  with exactly `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `charge.refunded`,
  `charge.dispute.created`; paste its signing secret (`whsec_…`) into Settings → Integrations → Stripe.
- [ ] **Xero** (OPS §13): app scopes `offline_access accounting.transactions accounting.contacts`; in
  Settings → Integrations → Xero set the tenant, revenue / payment (bank) / tax account codes, and
  **Sync from date** = the cutover day so Harvest history is never copied.
- [ ] After the above: Settings → Activity log → **Run checks now**; every row should be green.
- [ ] Production smoke test: send a $1 invoice to yourself, open it, pay by card, and check the
  invoice's "Delivery & payment trail" shows Delivered · Opened · Paid · Xero synced.

## 3. Decisions (Dzuy, after the cost review)
- [ ] **Vercel plan**: Hobby is for non-commercial use; Pro allows commercial use and hourly crons.
- [ ] **Re-enable the parked GitHub Actions** (`ops/workflows/` → `.github/workflows/`, OPS.md §2):
  CI, nightly encrypted off-site backup, keep-warm. Keep-warm costs ~4k Actions minutes/month at 5-minute
  cadence; alternatives are 10 minutes or UptimeRobot. The backup's read-only role will need to bypass
  RLS (or use the `postgres` user).
- [ ] **Sentry** (free tier) for error alerts.
- [ ] **Go-live date** and cutover order (section 4).
- [ ] **Password login**: keep as a fallback or turn off once Google sign-in works.

## 4. Cutover (once there's a date)
- [ ] Final Harvest → Track2 sync (MIGRATION-RUNBOOK.md). Needs the production `DATABASE_URL` on a
  machine, or added as a secret to the Claude cloud environment so Claude can run it.
- [ ] Invoice numbers: `ACCOUNT_ID=acc_demo node scripts/fix-number-sequences.mjs` (dry run), then
  `--confirm`. Track2 continues from Harvest's last number (was #392666 on 2026-10-13).
- [ ] Set `MIGRATION_LOCKED=1` in Vercel so the importer can't run over live data.
- [ ] Recreate recurring invoice profiles in Track2; switch Harvest's off the same day.
- [ ] Keep Harvest read-only for 30 days as a fallback.
- [ ] Production click-through: log time, timer, generate + send a test invoice to yourself, record a
  payment.

## 5. Chasity
- [ ] Review the new Expenses, Recurring, Invoices and Team screens; close BugHerd #15, #25, #26 (in DONE).
- [ ] Run the Harvest capture prompt for screens 7–12 ([spec 24](specs/24-harvest-ui-capture.md)) to
  settle the 26 details marked UNVERIFIED in specs [26](specs/26-expenses-parity.md),
  [27](specs/27-recurring-and-statuses-parity.md) and [28](specs/28-team-parity.md).
- [ ] Answer BugHerd #5, #7, #12.

## 6. Phase 2 (agreed, not started)
**Features**
- [ ] Assigned people access (BugHerd #20, spec 28 §3.3): managers approve, report on and edit their
  people. Data model and admin UI already exist; the permission changes don't.
- [ ] Rich-text project notes (#24), invoice message templates (#22), recurring project hours (#23).
- [ ] Recurring invoices that send automatically (spec 27).
- [ ] Receipt file uploads (needs file storage), expense quantities column, manager scope on the
  Detailed expense report (spec 26).
- [ ] Invite / resend invitation / reset-password emails; delete person; Person page (spec 28).

**Hardening**
- [ ] `onDelete: Restrict` on cascades so deletes can't wipe history.
- [ ] Database trigger enforcing INV-3 (invoiced/approved entries immutable) for scripts too.
- [ ] Members see account-wide hours on /reports; project rates/fees on create/edit should need `set_rates`.
- [ ] Xero tax-type mapping.
- [ ] Stripe refunds/disputes applied automatically (today they're traced + flagged for a person;
  needs `Payment.stripeRefundId`). Deleting a payment in Track2 doesn't delete it in Xero.
- [ ] Run `npm run test:chain` in CI against a throwaway Postgres service once CI is re-enabled.
- [ ] OAuth housekeeping: purge unused registered clients / expired codes (OPS.md §9a).
- [ ] Upgrade Next.js 14 → 15 and pin next-auth (currently a v5 beta).

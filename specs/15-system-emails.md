# 15 — System / Transactional Emails

Inventory of the automated emails Track2 sends. Grounded on observed examples from the reference system (screenshots collected 2026-08-06). **This is a starting inventory — more email types almost certainly exist; the "To confirm" list tracks the gaps.**

## Delivery model (proposed)

- **Provider:** a transactional email service (e.g. Postmark / SES / Resend) — decision pending. Configured like the other integrations ([14](14-integrations.md)): per-account sender identity + an API key stored encrypted at rest.
- **Sender identities:**
  - **Notifications** — `notifications@…` for digests/alerts/reminders (system voice).
  - **Invoices** — the account's configured invoice sender ([05](05-invoicing.md) `SenderAddress`), for client-facing billing mail (appears "from" the account, e.g. Big Sea).
  - **Auth/support** — `support@…` for sign-in codes.
- **Branding:** client-facing mail uses the account's `InvoiceAppearance` (logo, brand color) — see [spec 05 theming].
- **Preferences:** digests/reminders honor per-user notification settings with an **Unsubscribe** link; transactional mail (payment receipts, sign-in codes) is not unsubscribable.
- **Scheduling:** digests + reminders + threshold alerts run on scheduled jobs (Vercel Cron, like recurring invoices).

## Captured emails

| # | Name | Category | Trigger | Recipient | Sender | Key content / variables | CTA | Related |
|---|---|---|---|---|---|---|---|---|
| E1 | **Payment received — bank transfer/ACH** | Billing (internal) | An online ACH payment succeeds | Account owner/admin | Notifications (via account) | amount, client name, invoice #, "marked paid in your account" | — | [14] Stripe webhook → recordPayment; [05] |
| E2 | **Payment received — card (Stripe)** | Billing (internal) | An online card payment succeeds | Account owner/admin | Notifications (via account) | amount, client, invoice #, date, **paid through** (Stripe), **transaction ID** (ch_…), amount paid | — | [14] Stripe webhook |
| E3 | **Invoice reminder (past due)** | Billing (client-facing) | Invoice is past due (scheduled) | Client invoice recipient(s) | Invoices (account) | invoice #, days past due, amount due, finance-fee terms ("5% after 30 days"), remittance instructions, account address | **View and Pay Invoice Online** | [05] invoice lifecycle + `/i/[token]` |
| E4 | **Weekly time report** | Time tracking (digest) | Weekly schedule | Each team member | Notifications | date range, total hours, billable/non-billable split, per-day + per-task breakdown, per-project breakdown, capacity | Edit timesheet / Unsubscribe | [04] time; [07] reporting |
| E5 | **Timesheet past due** | Time tracking (reminder) | Timesheet deadline missed (admin-enabled) | The team member | Notifications | deadline date/time, period start | **Track time** / notification settings | [11] timesheet deadline + reminder rule |
| E6 | **Project budget alert** | Projects (alert) | Project crosses a time-budget % threshold | PMs + admins on the project | Notifications | project name, % of budget used, hours left (used/total), recurring-budget note | **View project report** | [03] project budgets |
| E7 | **Sign-in code (email OTP)** | Auth | Login requires an emailed code | The user signing in | Support | 6-digit code, "not you?" security note | — | [02] auth/sign-in security |

## To confirm (expected but not yet captured)

Very likely to exist — collect screenshots to spec faithfully:
- **Invoice sent** (to client) — the original "here's your invoice / View and Pay Online" email (E3 is the *reminder* variant).
- **Payment receipt / thank-you** (to the client) after they pay.
- **Estimate sent** (to client) + **estimate accepted/declined** (internal).
- **New-user invite / welcome** + **password reset**.
- **Invoice viewed by client** (internal notification).
- **Recurring invoice created/sent** notification.
- **Retainer low-balance / depleted** alert.
- **Payment failed / retry** (for online payments).
- **Weekly/daily admin summary** (account-level, vs the per-user E4).

## Acceptance criteria (for captured types)

- **AC-EMAIL-001** — *Given* an online payment succeeds (card or ACH, [14]), *when* `recordPayment` completes, *then* the account admin receives the matching **payment received** email (E1/E2) with amount, client, invoice #, method, and transaction id where present.
- **AC-EMAIL-002** — *Given* an `open` invoice becomes past due, *when* the reminder job runs, *then* the invoice recipient(s) receive E3 with the correct days-past-due, amount due, and a working `/i/[token]` pay link — and it is not sent for draft/paid invoices.
- **AC-EMAIL-003** — *Given* per-user digest settings, *when* the weekly job runs, *then* E4 reflects that user's own tracked time for the period and includes a functioning unsubscribe link; opting out suppresses future E4s.
- **AC-EMAIL-004** — *Given* the account's timesheet deadline + reminder rule ([11]), *when* a user is under the tracked-time threshold after the deadline, *then* E5 is sent once per the rule.
- **AC-EMAIL-005** — *Given* a project time budget, *when* tracked time crosses the configured threshold, *then* E6 is sent to the project's managers/admins with the correct percentage and hours remaining, once per threshold crossing (not repeatedly).
- **AC-EMAIL-006** — *Given* a login that requires an email code, *when* initiated, *then* E7 delivers a single-use, time-limited code; transactional auth mail is never suppressed by notification preferences.
- **AC-EMAIL-007** — *Given* any client-facing email (E3, invoice/estimate/receipt), *when* rendered, *then* it uses the account's sender identity + `InvoiceAppearance` branding, and internal notifications never expose another tenant's data (INV-5).

## Build order (when scheduled)
1. Email-provider integration + per-account sender config (encrypted key), shared render/layout with account branding.
2. Transactional first (highest value): E1/E2 payment receipts, E7 sign-in code.
3. Client-facing billing: invoice-sent + E3 reminder (+ receipt/thank-you) on the invoice lifecycle + a reminder cron.
4. Digests/alerts: E4 weekly report, E5 timesheet reminder, E6 budget alert — all on scheduled jobs with preference/unsubscribe handling.

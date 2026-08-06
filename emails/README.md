# Track2 transactional email templates

Big Sea-branded, table-based, MSO-safe HTML email templates (from Claude Design → "Track2 Email Templates"). These are the **source of truth** for the emails Track2 sends; they pair with the inventory + acceptance criteria in [`specs/15-system-emails.md`](../specs/15-system-emails.md). Rendering/sending is wired in the email-provider phase (spec 15 build order).

## Shared shell
Every template uses the same frame: an 8px **lime rope** strip, an **ink (`#0d2022`) header** with the white Big Sea logotype + an uppercase label, a white body card, a **teal (`#004348`)** amount / **green (`#047a44`)** primary CTA, and an `#f7f8f8` footer with Email-preferences + Unsubscribe links. Fonts fall back to Arial (email-safe); brand type (Poppins/Fraunces) is not used in email.

## Templates

| File | Label | Trigger (spec 15) | Recipient | Merge fields |
|---|---|---|---|---|
| `invoice-sent.html` | Invoice | Invoice sent to client | Client | client_name, invoice_number, amount_due, issue_date, due_date, line_items, pay_url, invoice_url, pdf_url |
| `invoice-overdue.html` | Overdue | Invoice past due (E3) | Client | client_name, invoice_number, amount_due, days_overdue, finance_fee_terms, pay_url, invoice_url |
| `payment-receipt.html` | Receipt | Payment received (client copy) | Client | client_name, invoice_number, amount_paid, paid_date, payment_method, receipt_url |
| `welcome-verify.html` | Welcome | New account / verify email | New user | first_name, verify_url, expiry_hours |
| `team-invite.html` | Invitation | Person invited to the account | Invited user | inviter_name, workspace_name, role, accept_url, expiry_days |
| `password-reset.html` | Security | Password reset requested | User | first_name, reset_url, expiry_minutes, request_time, request_ip |
| `timesheet-reminder.html` | Timesheet | Timesheet short of capacity (E5) | Team member | first_name, week_range, hours_logged, capacity, hours_missing, billable_hours, billable_pct, lock_time, timesheet_url |

All also take `preferences_url` + `unsubscribe_url` (digests/reminders); transactional mail (receipts, sign-in codes, password reset) is not unsubscribable.

## Before sending (per template header comment)
1. Replace the logotype `src` (`https://REPLACE-WITH-HOSTED-URL/big-sea-logotype-white.png`) with a hosted https URL — email clients can't use app-relative or bundled paths. Host the white logotype (in `public/brand/`) at a stable public URL.
2. Fill the `[postal address]` in the footer (CAN-SPAM).
3. Substitute the `{{merge_fields}}` at send time; `{{line_items}}` is a repeated `<tr>` block.
4. Send via the chosen provider (spec 14 email integration) using the account's sender identity.

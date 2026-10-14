# 27 — Recurring invoices & invoice statuses (Harvest parity)

Covers capture screens **8 (Invoices > Recurring)** and **9 (invoice statuses)** from
[24-harvest-ui-capture.md](24-harvest-ui-capture.md). Nobody could log in to Harvest's web UI for this
pass, so the notes come from Harvest's help center (via the Harvest connector) and from **read-only**
calls against Big Sea's live Harvest account (`list_invoices`, `get_invoice`, 2026-10-13). Anything
not documented or observed is marked **UNVERIFIED — confirm in Harvest**; re-run capture prompt
items 8 and 9 in a signed-in browser to settle those.

Extends [05-invoicing.md](05-invoicing.md) and [10-recurring-retainers.md](10-recurring-retainers.md).
Spec 10 already uses AC-REC-001…004, so the recurring criteria here start at **AC-REC-101**.

## Harvest behavior: recurring invoices (screen 8)

Sources: [Recurring invoices](https://support.getharvest.com/hc/en-us/articles/360048181052-Recurring-invoices),
[Should I set up a standard, recurring, or retainer invoice?](https://support.getharvest.com/hc/en-us/articles/360048686571-Should-I-set-up-a-standard-recurring-or-retainer-invoice),
[Can I set a first issue date of today?](https://support.getharvest.com/hc/en-us/articles/28675483805453-Can-I-set-a-first-issue-date-of-today-for-a-recurring-invoice),
[Searching for standard or recurring invoices](https://support.getharvest.com/hc/en-us/articles/42664043609997-Searching-for-standard-or-recurring-invoices),
[Fixed Fee on a recurring template](https://support.getharvest.com/hc/en-us/articles/11580597251597-How-can-I-include-a-Fixed-Fee-project-on-a-recurring-invoice-template),
[Late invoice reminder messages](https://support.getharvest.com/hc/en-us/articles/18013752929293-Late-invoice-reminder-messages).

- **Where:** Invoices > Recurring lists the templates. Green button **"+ New recurring invoice"**.
  Generated invoices appear under Invoices > Overview, and also inside each template ("click into a
  specific template").
- **New recurring invoice, step 1:** choose **Client**, then one of two radio options:
  - **"Create a free form recurring invoice"** → button **"Next step"**. Same content every time. Can
    auto-send or save as draft.
  - **"Create a recurring invoice for tracked time and expenses"** → button **"Choose projects"**.
    Pulls all uninvoiced billable hours/expenses tracked before the creation date, plus any manual
    lines. **Draft only** (never auto-sent). Hours and expenses each have "include?" and "how to
    display" options; expenses can attach an expense report. Then **"Review invoice"**.
- **Schedule fields:** a frequency ("yearly, monthly, or a custom time period") and a **"First issue
  date"**.
  - The first issue date **cannot be today**. Harvest's advice: make today's invoice a one-time
    invoice and start the template on the next date.
  - Monthly on the 31st: in shorter months Harvest issues on **the last day of the month**, and goes
    back to the 31st in long months.
  - Exact frequency options and their order: **UNVERIFIED — confirm in Harvest.** Track2 offers:
    Weekly, Every 2 weeks, Every 4 weeks, Monthly, Every 2 months, Quarterly, Every 6 months,
    Yearly, Every 2 years, plus a custom "every N days/weeks/months".
  - **"Number of invoices to issue"** (blank = no end): the field wording, its position, and how a
    template reads once it has issued its last invoice are **UNVERIFIED — confirm in Harvest** (the
    help center doesn't mention it). BugHerd #13 asked for it. Track2 shows "N left" and
    "Completed".
- **Send mode (free form only):** "Automatically send this invoice" or "Create a draft invoice for
  me to send manually".
  - Only **Administrators** can choose automatic sending.
  - Auto-send asks for **Sender**, **Recipients** (typed, or picked from recently used), **Message
    subject**, **Message body**, and checkboxes **Reminder** and (with online payment) **Thank-you**.
- **Template body:** "+ Add item" line items (Item type, Description, Quantity, Unit price, Linked
  project), **Subject**, **Notes**, and Online payment options. Button **"Save recurring invoice"**.
- **Variables:** the subject and line descriptions accept variables (e.g. the month/year of
  generation), listed at Invoices > Configure > Messages. Big Sea's live recurring invoice 392600
  has a line ending "October 2026" on a 2026-09-15 issue, so a "next month" variable is in use.
  Variable names are **UNVERIFIED**.
- **Generation:** runs one by one from about midnight in the account timezone on the scheduled day.
  An auto-send template sends at about the same time. The live API shows recurring-generated
  invoices issued on the template's day (`issued_at` 2026-09-15 for every profile due on the 15th),
  with `due_at` = issue + term.
- **Fixed fee:** templates don't pull fixed fees automatically. A line linked to a Fixed Fee project
  keeps generating even after the fee is fully invoiced (already in spec 05).
- **Edit:** open the template, then **"Edit recurring template"**, then "Save recurring invoice".
  Changes apply only to future invoices. A template whose client turned on Stripe recurring payments
  is locked except for recipients and messages.
- **Pause:** "stop a recurring invoice template from being sent" without deleting it. Nothing is
  generated until it is unpaused. Button wording ("Pause"/"Unpause"?) is **UNVERIFIED**.
- **Delete:** from the template, **"Delete invoice"** (top right), then confirm with **"Delete
  recurring invoice"**. Permanent. Invoices already generated stay.
- **Search:** recurring templates can be searched by subject, line-item description and note
  contents (not by ID).
- **Reminders on a template:** sending settings have a **Reminder** checkbox. Unchecking it affects
  only future invoices.
- **List columns** (spec 10, observed earlier): Client · Invoice subject · Next invoice (date +
  "every month") · Amount. Paused rows show "Paused".

## Harvest behavior: invoice statuses (screen 9)

Sources: [Invoices overview](https://support.getharvest.com/hc/en-us/articles/12389698137869-Invoices-overview),
[Recording and removing invoice payments and write-offs](https://support.getharvest.com/hc/en-us/articles/360048181032-Recording-and-removing-invoice-payments-and-write-offs),
[Invoice reports](https://support.getharvest.com/hc/en-us/articles/360048686391-Invoice-reports-and-payments-received-reports),
[Mobile app: managing invoices](https://support.getharvest.com/hc/en-us/articles/360048180092-Mobile-app-Managing-invoices-in-the-Reports-tab),
[Editing and deleting invoices](https://support.getharvest.com/hc/en-us/articles/360048181012-Editing-and-deleting-invoices-and-estimates),
[Late invoice reminder messages](https://support.getharvest.com/hc/en-us/articles/18013752929293-Late-invoice-reminder-messages).

- **Status words:** Draft, Sent, Late, Paid, Written-off. Colors: gray Draft (the mobile help says
  "a gray Draft"), blue Sent, red Late, green Paid (spec 24). The exact banner and badge wording at
  the top of an invoice is **UNVERIFIED — confirm in Harvest**.
- **Live API `display_status`** (read-only list, 2026-10-13): `draft`, `sent`, `late`, `paid`,
  `pending`, each with a `status_badge_date`:
  - **sent:** the date it was sent (e.g. 392665 sent 2026-10-09).
  - **paid:** the date it was paid (e.g. 392652 paid 2026-09-10).
  - **draft / late / pending:** null.
  - So the list badge most likely reads "Sent {date}" / "Paid {date}". **UNVERIFIED wording.**
- **Late** = open (sent) and past its due date. Observed:
  - The due day itself is still Sent. 392640 is due 2026-10-15 and reads `sent` on 10-13; 392633 was
    due 10-10 and reads `late`.
  - **$0 open invoices past due still read Late** (MetroLagoons 392561/392558, amount 0.00).
- **Partially paid:** no separate status. A partly paid invoice stays **Sent** (Brooks 392655: $6,080,
  $2,875 due, `sent`) or **Late** (St. Pete 392594: $1,608.08, $1,003.58 due, `late`). Harvest "displays
  the remaining balance so you can resend the invoice".
- **Pending:** seen on an open recurring invoice that is past due, with no sent date (392600). It
  outranks Late. Probably a payment in progress (ACH) or a queued send. **UNVERIFIED — confirm in
  Harvest.**
- **Written off:** only for sent (or marked-sent) invoices, via Actions, with optional notes, then
  "Write off invoice". A partly paid invoice that is written off shows **only "Written-off"**.
  Payments and the written-off balance are still reported. It can be reopened ("Re-open Invoice",
  mobile). Writing off keeps the debt on record; deleting removes the invoice.
- **Closed:** in Harvest this is a **filter group** (paid + written-off; mobile "Closed invoices
  include paid and written-off invoices"), not a status anyone sets. Track2's stored `closed` status
  comes from imports. It shows a gray "Closed" badge and falls under the Closed filter.
- **Overview tabs:** **Open** = every invoice not fully paid, **including drafts**, sent, late and
  partly paid. **All invoices** = everything. Retainer-funding invoices carry a retainer label.
- **Filters** (on both tabs, apply on select, combinable): **Status** (all, open, closed, draft,
  sent, late), **Client** (active, then archived, A–Z, even with no invoices), **Project** (linked
  invoices only), **Timeframe** (month, quarter, year, all time).
- **Sorting:** every column except Status sorts. Clicking again reverses.
- **Totals:** Open shows a balance total. All invoices shows amount, written-off, paid and balance
  totals, per currency.
- **"Total open"** summary = all unpaid amounts on draft, sent and late invoices, for all time.
- **Reminders:** an invoice with a reminder shows a clock icon with "Email client a reminder once
  invoice is…" and an "Edit reminder" link at the top left. The green **"Send reminder"** button
  sits top left of the invoice.
- **Payments:** "Record payment" (date + amount). Delete a payment with the ✕ in **Invoice history**.
  Payments can't be edited (delete, then re-record).
- **Delete:** type **DELETE** to confirm, then "Delete invoice". Hours and expenses unlock.

## Acceptance criteria

### Statuses
- **AC-STAT-001** — *Given* an open invoice whose due date is today (account timezone), *when* the
  list and the invoice page render, *then* both read **Sent** ("Due today"). *Given* the due date was
  yesterday, *then* both read **Late**.
- **AC-STAT-002** — *Given* an open invoice of $0.00 past its due date, *when* rendered, *then* it
  reads **Late** (Harvest-observed).
- **AC-STAT-003** — *Given* an open invoice with $500 of $1,200 paid and not yet due, *when* rendered,
  *then* the badge is **Sent** (not a separate "Partial" status). The banner detail shows
  "$700.00 due … · $500.00 of $1,200.00 paid". Past due, it is **Late** with the same detail.
- **AC-STAT-004** — *Given* invoices in every state, *when* the Open tab is shown, *then* it lists
  draft and open (sent/late/partly paid) invoices and excludes paid, written-off and closed ones.
  "Total open" sums the balance of draft and open invoices.
- **AC-STAT-005** — *Given* the Status filter, *when* its options are listed, *then* they are, in
  order: All statuses, Open, Closed, Draft, Sent, Late. *When* one is picked, *then* the list
  narrows immediately (no Apply step) and combines with the client, timeframe and search filters:
  - Open = draft + open
  - Closed = paid + written off + closed
  - Draft = draft
  - Sent = open and not past due
  - Late = open and past due
- **AC-STAT-006** — *Given* a sent invoice, *when* listed, *then* under the badge it shows the sent
  date. A paid invoice shows its paid-on date (last payment). Draft and late show no date.
  (Wording UNVERIFIED.)
- **AC-STAT-007** — *Given* a written-off invoice, *when* "Re-open invoice" is used, *then* it goes
  back to **open** through the guarded state machine (INV-7). It reads Sent or Late by due date,
  keeps its number, entries and payments, and the reopen is audit-logged. A partly paid written-off
  invoice still reads only "Written off" until reopened.
- **AC-STAT-008** — Badge colors: Draft gray, Sent blue, Late red, Paid green, Written off and
  Closed muted gray. The banner at the top of the invoice uses the same hue as the badge.

### Recurring
- **AC-REC-101** — *Given* the new or edit template form, *when* a first or next issue date of
  **today or earlier** (account timezone) is submitted, *then* it is rejected with "The first issue
  date must be after today. To bill today, create a one-time invoice." The date field defaults to
  tomorrow.
- **AC-REC-102** — *Given* a monthly template first issued on Jan 31, *when* it generates through
  the year, *then* the issue dates are Jan 31, Feb 28 (29 in a leap year), Mar 31, Apr 30. The anchor
  day is kept, not drifted to the 28th. The same holds for every-N-months, quarterly and yearly
  (Feb 29 anchors fall back to Feb 28).
- **AC-REC-103** — *Given* a due template, *when* it generates, *then* the draft's **issue date =
  the scheduled date** and its **due date = issue date + payment term**. Sending keeps both.
- **AC-REC-104** — *Given* the "How often" select, *when* opened, *then* it lists Weekly, Every 2
  weeks, Every 4 weeks, Monthly, Every 2 months, Quarterly, Every 6 months, Yearly, Every 2 years,
  Custom…. Custom shows "every [n] [days|weeks|months]". (Option list UNVERIFIED.)
- **AC-REC-105** — *Given* a template, *when* "Edit recurring template" is saved, *then* subject,
  line items, notes, payment term, schedule and the number of invoices to issue are updated. Only
  future invoices change. Invoices already generated are untouched.
- **AC-REC-106** — *Given* the new template form, *when* line items are added with "+ Add item"
  (description, quantity, unit price), *then* the template amount = Σ round(qty × unit price) in
  integer cents (INV-1), and every line is cloned onto each generated draft.
- **AC-REC-107** — *Given* a "Number of invoices to issue" of 3, *when* three invoices have been
  generated, *then* the template stops and reads **Completed**. The Next invoice column shows "—".
  Pause/Resume is hidden until more invoices are allowed. Blank = no end. (Harvest wording
  UNVERIFIED.)
- **AC-REC-108** — *Given* the recurring list, *when* text is typed in the search box, *then*
  templates whose subject, line description or notes contain it (case-insensitive) are listed.
- **AC-REC-109** — *Given* any recurring write, *then* it requires `manage_invoices` (via `can()`)
  and is scoped to the session account (INV-5). The cron path keeps its per-profile isolation and
  idempotent claim (AC-REC-003).

## Gap table (Track2 vs Harvest, 2026-10-14)

| # | Area | Harvest | Track2 before this pass | Priority | Status |
|---|---|---|---|---|---|
| G1 | Late boundary | Late from the day after the due date (calendar day, account tz) | List badge compared timestamps (UTC now > UTC-midnight due), so it read **Late on the due date** while the banner said "Due today" (`invoiceState.displayBadge`, `app/invoices/page.tsx`) | P1 | **Built** (AC-STAT-001/002) |
| G2 | Open tab / Total open | Open includes drafts; Total open includes drafts | Open tab and Total open were `status='open'` only (`app/invoices/page.tsx`) | P1 | **Built** (AC-STAT-004) |
| G3 | Status filter | all/open/closed/draft/sent/late, applies on select | None (client, period, search + Apply button) | P1 | **Built** (AC-STAT-005) |
| G4 | First issue date | Must be after today | Defaulted to today; accepted any date (`app/recurring/actions.ts`) | P1 | **Built** (AC-REC-101) |
| G5 | Month-end schedule | 31st → last day of short months, back to 31st | Drifted: Jan 31 → Feb 28 → Mar 28 (`modules/invoicing/recurring.ts` advanced from the clamped date) | P1 | **Built**, migration `anchorDay` (AC-REC-102) |
| G6 | Generated dates | Issue date = schedule day; due = issue + term | Draft had no issue/due date and got "today" at send (`generateRecurring.ts`) | P1 | **Built** (AC-REC-103) |
| G7 | Template line items + edit | Multi-line template, Subject, Notes; "Edit recurring template" | One-line amount only on create; only the remaining count could be edited (`components/NewRecurringForm.tsx`) | P1 | **Built**: `/recurring/new`, `/recurring/[id]/edit` (AC-REC-105/106) |
| G8 | Frequency presets | Frequency select (options UNVERIFIED) | Raw frequency + "Every" number | P2 | **Built** (AC-REC-104) |
| G9 | Recurring search | Search by subject/line/notes | None | P2 | **Built** (AC-REC-108) |
| G10 | Badge date | Sent {date} / Paid {date} | Separate "Due" text column only | P2 | **Built** (AC-STAT-006) |
| G11 | Reopen written-off | "Re-open Invoice" | `written_off` terminal (`invoiceState.LEGAL`) | P2 | **Built** (AC-STAT-007) |
| G12 | Auto-send recurring | Free form templates can auto-send (Admins only) with sender, recipients, message, Reminder, Thank-you | Drafts only | P2 | Open: needs schema (send mode, recipients, message) and email at cron time |
| G13 | Template detail + generated invoices | Click a template to see the invoices it generated | No invoice → profile link | P2 | Open: needs `Invoice.recurringProfileId` + import mapping from Harvest `recurring_invoice_id` |
| G14 | Recurring from tracked time | Second template type pulling uninvoiced T&M time/expenses (draft only) | Free form only | P2 | Open |
| G15 | Variables in subject/lines | Month/year variables | None in recurring generation | P3 | Open: variable names UNVERIFIED |
| G16 | Pending badge | `pending` display status | `isPending` never set | P3 | Open: meaning UNVERIFIED |
| G17 | Write-off notes | Optional notes when writing off | No notes field | P3 | Open |
| G18 | Project filter + sortable Status/Balance columns, per-currency totals on the invoice list | Present | Missing | P3 | Open |
| G19 | Reminder line on invoice ("Email client a reminder once invoice is…") + per-template Reminder checkbox | Present | "Send payment reminder" menu item only | P3 | Open |
| G20 | Delete confirm by typing DELETE | Present | Confirm dialog | P3 | Open |

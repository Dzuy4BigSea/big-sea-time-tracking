# 05 — Invoicing

Where tracked time becomes revenue. The invoice **state machine**, the **uninvoiced pool**, and **payment math** are the highest-risk areas — QA should hit them hardest.

## Creating an invoice

Three entry points:

1. **From tracked time** — pick a client, a date range, and optionally specific projects. The system pulls all **billable, un-invoiced, `open`-or-`approved`** time entries matching, and builds `time` line items.
2. **Free-form** — add `free_form`/`flat` line items manually (description, qty, unit price).
3. **From estimate** — convert (see [06](06-estimates.md)).

An invoice is single-currency; only entries whose project/client currency matches the invoice currency may be pulled.

### Grouping tracked time into line items

Account/invoice setting `timeGrouping`:
- `by_task` (default): one line per task — description "Task name", qty = summed hours, unit price = the entries' rate (must be uniform; if rates differ within a task, split into one line per distinct rate).
- `by_person`: one line per person.
- `by_project`: one line per project.
- `detailed`: one line per time entry (date, person, notes).

### Fixed-fee projects (Harvest-exact; `modules/invoicing/fixedFee.ts`)

"Create an invoice for tracked time, expenses, or fixed fees" opens a project picker (`/invoices/generate?clientId=…`). Each selected **Fixed Fee** project contributes ONE `flat` line (qty 1, linked via `InvoiceLineItem.linkedProjectId`) for its **remaining uninvoiced fee = project fee − amount already invoiced for the project**; nothing remaining → no line.
- **Project fee** = `Project.projectFeesCents` (Harvest "Project fees"), falling back to `budgetValue` when `budgetMethod = fee_total`.
- **Amount invoiced** = sum of `amountCents` of every line linked to the project on any existing invoice — draft, open, paid, closed and written off — excluding `expense` lines (expenses bill on top of the fee). Deleting an invoice deletes its lines, returning their amount to the remaining fee. Drafts count, so two drafts can never claim the same fee. Because it is re-derived from lines, lowering the unit price on a draft (e.g. $1,000 → $600) leaves the difference available to a later invoice.
- **Hours** tracked on a fixed-fee project are NOT billed by rate and NOT linked to the invoice; they remain uninvoiced hours.
- Concurrent generations lock the fixed-fee project rows and re-derive the remainder inside the transaction; a loser rolls back.
- **Recurring** invoices may carry a line linked to a fixed-fee project and keep generating regardless of fee exhaustion.
- The draft editor shows **"Show project context"** under the unit price of each fixed-fee line: project notes; total project fee / amount invoiced (other invoices) / this invoice / remaining to invoice; related invoices with this project's amount on each (linked for invoice managers).
- **Uninvoiced amount** for a fixed-fee project (project card, client page, retainers, dashboard) = fee − invoiced; its hours still count as uninvoiced hours. The Time report's "Uninvoiced amount" keeps excluding Fixed Fee projects (as Harvest's does).

Each contributing TimeEntry gets `invoiceLineItemId` set and `lockState='invoiced'` **only when the invoice leaves `draft`** (see state machine). While `draft`, entries are *reserved* to the invoice but transition to `invoiced` on send. (Design choice: reserve-on-add, lock-on-send — documented so QA tests the boundary. See AC-INV-014.)

## Totals math (deterministic, integer cents)

```
lineAmount   = round(quantity * unitPriceCents)          # round half up
subtotal     = Σ lineAmount
discountCents = round(subtotal * discountPercent/100)     # if discountPercent set
taxableBase  = Σ lineAmount where taxable == true
tax1Cents    = round(taxableBase * tax1Percent/100)
tax2Cents    = round(taxableBase * tax2Percent/100)       # tax2 on base, not compounded
taxCents     = tax1Cents + tax2Cents
total        = subtotal - discountCents + taxCents
due          = total - paidCents
```
Discount applies to subtotal before tax. Tax is computed on the taxable base **after** discount only if account setting `discountBeforeTax=true` (default true). All rounding is half-up on integer cents.

## Status: stored state vs display badge (revised from live observation)

Two layers:

- **Stored `status`:** `draft`, `open`, `paid`, `written_off`, `closed`.
- **Display badge** (derived for the list/report UI): `Draft`, `Sent`, `Pending`, `Paid`, `Late`, `Written off`.
  - `Sent` = stored `open`, sent, due date not past.
  - `Late` = stored `open`, sent, `dueDate < today`, `dueCents > 0`.
  - `Pending` = stored `open`, queued/awaiting (e.g. scheduled send / awaiting online-payment settlement).
  - `Paid` = stored `paid`.

## State machine

```
       ┌──────┐   send    ┌──────┐  paidCents ≥ total   ┌──────┐
       │draft │──────────▶│ open │─────────────────────▶│ paid │
       └──────┘  ◀────────└──────┘◀──── delete payment ──└──────┘
          │   mark as draft  │  │
   delete │   (releases      │  │ partial payment (stays open, due↓)
          ▼    entries)      ▼  ▼
      (removed)          write off / close → written_off / closed
```

Transition rules (guarded — **INV-7**):
- `draft → open` (**send**): requires ≥1 line item, issue date (defaults today), due date (from payment term). Sets `sentAt`, generates `number` from `account.invoiceNumberSeq` (**INV-6**), stamps reserved time/expense entries to `lockState='invoiced'`, issues `publicToken`.
- `open → paid`: automatic when `paidCents >= totalCents`.
- `open → open`: partial payment; `dueCents` decreases.
- **`open → draft` ("Mark as draft"):** *allowed* (observed). Reverts to draft and **releases** its entries back to the uninvoiced pool. The already-assigned `number` is retained (not reused for another invoice).
- `paid → open`: deleting a payment so `paid < total` re-derives status.
- any non-paid → `written_off`: write off remaining balance (entries stay locked; `totalCents` preserved for audit).
- `open/paid → closed`: manual close for records.
- **Delete:** available on **both draft and sent** invoices (observed — Actions ▸ Delete on a sent invoice). Deleting releases its entries back to the uninvoiced pool. (Recommend a confirm dialog + audit-log entry for deleting a sent, numbered invoice.)

Illegal transitions (e.g. `draft → paid`) are rejected with a clear error.

## Other invoice actions (observed on a sent invoice)

Resend · Copy invoice link · Edit invoice · Mark as draft · Duplicate · **Create recurring** (→ [10](10-recurring-retainers.md)) · Write off · Delete · Record payment · Copy to Xero (integration). Each sent invoice also carries **reminder settings** ("email once 1 day late, then every 7 days after") and an **invoice history / audit trail**.

## Invoice page layout (Harvest parity, from Big Sea's live Harvest)

- Title "Invoice {number}" + status pill (+ "View on Xero ↗" when copied to Xero). Right: **Preview** (the client view `/i/{token}`, sent invoices only), **PDF** and **Print** (the print view; the browser's dialog saves a PDF).
- "Latest activity: {summary}. {actor} on MM/DD/YYYY at h:mma  View history" (account timezone).
- "🔗 This invoice is linked to the project {name}" (every project a line is linked to).
- Action row: green **Send invoice** (draft) or **Send reminder** (open — sent or late); **Copy invoice link** (copies `/i/{token}`, shows "Copied!"; not on drafts); **Edit invoice** (draft/open); **Actions ▾**: Resend invoice, Mark as draft, Copy to Xero, Duplicate, Create recurring, Set up reminder email, —, Write off invoice / Re-open invoice, Delete. Right side: "Balance: $1,500.00 (6 days late)" (late part red; "(due in N days)" / "(due today)" otherwise) and **Record payment** (open invoices).
- "Set up reminder email" opens Invoices → Configure → Messages (the reminder wording). Harvest's per-invoice reminder schedule ("email once 1 day late, then every 7 days") is **not built** — there is no schedule model or cron yet.
- The invoice document carries the status stamp (specs/27). "Total hours" on the invoice is not built (no field).

## Editing an invoice (`/invoices/{id}/edit`, Harvest layout)

One form, one save (**Update invoice** / Cancel in a sticky footer):
- Left: **Invoice ID**, PO Number, Issue Date, **Due Date** (Upon receipt / Net 15 / Net 30 / Net 45 / Net 60 / Custom → a date). Due date = issue date + term (stored only once there is an issue date; send fills both in). Right: Invoice For (client, read-only), Tax % (+ name, and a second tax), Discount %, Currency.
- Full-width Subject. Line items: ✕ remove | Item Type (Invoices → Configure → Item types) | Description (+ "Linked project" select of the client's projects) | Quantity | Unit Price | Amount (computed). **+ Add item**, **Reorder rows** (▲/▼). Per-line Tax checkbox appears once a tax is set. Subtotal / Amount Due update live with the same integer-cent math; the server recomputes authoritatively.
- Notes "(optional, displayed on invoice)" with "Formatting tips: \*bold\* \_italics\_" — rendered on the invoice, client view and print view (`modules/invoicing/notesFormat.ts`; markers only at word boundaries, never raw HTML).
- **Accept online payments for this invoice** with Credit Card / ACH (`Invoice.acceptOnlinePayments`, `allowCardPayments`, `allowAchPayments`). These narrow the company's Stripe connection methods; they never add a method the connection doesn't offer. Off (or nothing left) → no Pay button and the checkout action refuses.

Rules (`modules/invoicing/editInvoice.ts`, `app/invoices/[id]/edit/actions.ts`):
- Editable when **draft or open** (sent/late, including partly paid). Paid, written-off and closed invoices are read-only.
- Line math: quantity rounded half-up to 2 decimals; amount = round(qty × unit price) half-up, integer cents (INV-1). Totals via `recomputeInvoiceTotals`, which refuses a total below what has been paid and re-derives open ↔ paid — the only status change an edit can cause (INV-7).
- Lines linked to tracked time/expenses may be edited (description, qty, price). **Removing** such a line unlinks its time entries/expenses (`invoiceLineItemId = null`, `lockState = 'open'`) in the same transaction, so they are uninvoiced again (INV-4). Fixed-fee lines keep `linkedProjectId` (fixedFee.ts counts linked lines). New lines are `free_form`.
- **Invoice ID**: unique per account (DB unique + friendly error); never a number another invoice holds, or one a deleted or renumbered invoice used (audit `retiredNumber`, INV-6). An assigned number can't be cleared; an unnumbered draft may stay unnumbered. A numeric ID above `Account.invoiceNumberSeq` moves the sequence there, so the next invoice follows it (Harvest: "As long as the invoice ID you use is the largest ID in the account, the next invoice will follow the new sequence").
- Currency can't change once payments are recorded or while billed time/expenses are on the invoice.
- `manage_invoices` via `can()`, account-scoped (INV-5), one audit row ("Invoice updated (…)") plus one for an ID change.

## Sending

- Send by email (records `sentAt`) or copy a public link (`/i/{publicToken}`).
- The public link renders a read-only invoice + PDF download; visiting stamps `lastViewedAt`. No login. Token is unguessable (≥128-bit).

## Payments

- Record manual payments: amount (>0, ≤ due unless `allowOverpayment`), date, method, note.
- `paidCents = Σ payments`. Status re-derives after every payment add/delete.
- Overpayment disallowed by default (rejected if amount > due).

## Uninvoiced pool (INV-4 focus)

- A time entry is "uninvoiced" iff `invoiceLineItemId is null` AND `isBillable` AND `lockState != 'invoiced'`.
- Adding to an invoice removes it from the pool; deleting/voiding the invoice (or removing the line) returns it.
- **No entry may be on two non-void invoices** — enforced by `invoiceLineItemId` being singular and checked in a transaction at add time.

## Acceptance criteria

- **AC-INV-001** — *Given* 3 billable un-invoiced entries (Design 2h@$120, Design 1h@$120, Dev 4h@$150) and `timeGrouping=by_task`, *when* an invoice is generated, *then* two line items result: Design 3h × $120 = $360, Dev 4h × $150 = $600, subtotal $960.
- **AC-INV-002** — *Given* entries for the same task at two different rates, *when* grouped `by_task`, *then* they split into two line items (one per rate).
- **AC-INV-003** — *Given* a Fixed Fee project with 20h logged, a $5,000 fee and nothing invoiced, *when* it is picked for a new invoice, *then* one `flat` line of qty 1 × $5,000 linked to the project appears (not 20×rate), and the 20h of entries are NOT linked to the invoice (they stay uninvoiced hours).
- **AC-INV-003a** — *Given* a $1,000 fixed fee whose generated draft line was edited to $600, *when* the project is invoiced again, *then* the new line is $400; *when* invoiced a third time, *then* no fixed-fee line is added.
- **AC-INV-003b** — *Given* a fixed-fee project whose fee is fully invoiced (or has no fee), *when* picked, *then* no fixed-fee line is added (and with nothing else to bill, no invoice is created).
- **AC-INV-003c** — *Given* a draft holding a fixed-fee line, *when* the draft is deleted, *then* its amount returns to the project's remaining fee.
- **AC-INV-003d** — *Given* a draft with a fixed-fee line, *when* "Show project context" is opened, *then* it shows project notes, total fee, amount invoiced, remaining to invoice, and the related invoices with this project's amount on each.
- **AC-INV-003e** — *Given* a fixed-fee project with a $1,000 fee and $600 invoiced, *when* its project card is viewed, *then* "Uninvoiced amount" is $400 and its uninvoiced hours are shown separately.
- **AC-INV-004** — *Given* subtotal $1,000, discount 10%, tax1 8% taxable, `discountBeforeTax=true`, *when* totals compute, *then* discount=$100, tax=$72 (8% of $900), total=$972.
- **AC-INV-005** — *Given* a draft invoice with 0 line items, *when* send is attempted, *then* it is rejected.
- **AC-INV-006** — *Given* a draft invoice, *when* sent, *then* it gets a unique sequential `number`, `sentAt` set, a `publicToken`, and all its time entries become `lockState='invoiced'`.
- **AC-INV-007** — *Given* two invoices sent in sequence, *when* numbers are compared, *then* the second is exactly the first + 1 (no gaps, no reuse, unique per account). (**INV-6**)
- **AC-INV-008** — *Given* an open invoice total $972, *when* a $500 payment is recorded, *then* status stays `open`, `paidCents=50000`, `dueCents=47200`.
- **AC-INV-009** — *Given* the same invoice, *when* a further $472 payment is recorded, *then* status becomes `paid`, `dueCents=0`.
- **AC-INV-010** — *Given* an open invoice with due $472, *when* a $500 payment is attempted and `allowOverpayment=false`, *then* it is rejected.
- **AC-INV-011** — *Given* a paid invoice, *when* a payment is deleted so paid < total, *then* status re-derives to `open`.
- **AC-INV-012** — *Given* a draft invoice, *when* it is deleted, *then* its reserved time entries return to the uninvoiced pool (`invoiceLineItemId=null`, editable again).
- **AC-INV-013** — *Given* a sent invoice, *when* "Mark as draft" is used, *then* status → `draft`, its entries return to the uninvoiced pool, and its assigned `number` is retained (never reissued to a different invoice).
- **AC-INV-013b** — *Given* a sent invoice, *when* deleted (with confirmation), *then* it is removed, its entries return to the uninvoiced pool, and an audit-log row records the deletion.
- **AC-INV-013c** — *Given* a sent invoice, *when* "Write off" is used, *then* status → `written_off`, entries stay locked, and `totalCents` is preserved for reporting.
- **AC-INV-014** — *Given* a billable entry already reserved on invoice X, *when* an attempt is made to add it to invoice Y, *then* it is rejected (no double-invoicing, **INV-4**).
- **AC-INV-015** — *Given* an illegal transition (`draft → paid`), *when* attempted, *then* it is rejected with a clear error and no state change. (**INV-7**)
- **AC-INV-016** — *Given* a public token URL, *when* opened without auth, *then* a read-only invoice renders and `lastViewedAt` is stamped; an invalid token 404s.
- **AC-INV-017** — *Given* concurrent "generate invoice" requests pulling overlapping entries, *when* both run, *then* each entry lands on at most one invoice (transactional reservation).
- **AC-INV-018** — *Given* an invoice in a client's currency (EUR), *when* generation runs, *then* only EUR-project entries are pulled; USD entries are excluded.
- **AC-INV-019** — *Given* an open invoice with 3 lines, *when* one line's qty is edited, one line is added and one is removed in the editor and saved, *then* the stored lines match the editor in order, every amount = round(qty × price) half-up, and the totals are recomputed.
- **AC-INV-020** — *Given* a line that bills 4 time entries, *when* it is removed from the invoice, *then* those entries have `invoiceLineItemId = null`, `lockState = 'open'` and are uninvoiced again, in the same transaction as the edit.
- **AC-INV-021** — *Given* an open invoice with $500 paid, *when* an edit would make the total $400, *then* the save is refused and nothing changes.
- **AC-INV-022** — *Given* invoice 1005 with sequence at 1010, *when* its ID is changed to 392700, *then* it saves and the next invoice sent gets 392701; *when* changed to an ID another invoice (or a deleted invoice) used, *then* the save is refused with a clear message.
- **AC-INV-023** — *Given* an invoice with "Accept online payments" off (or only ACH while the connection offers only card), *when* its client link is opened, *then* no Pay button shows and the checkout action does nothing.
- **AC-INV-024** — *Given* a sent invoice, *when* "Copy invoice link" is clicked, *then* the `/i/{token}` URL is on the clipboard and the button reads "Copied!"; drafts have no such button.
- **AC-INV-025** — *Given* an open invoice 6 days past due with $1,500 due, *when* its page renders, *then* the action row reads "Balance: $1,500.00 (6 days late)" with the late part in red.

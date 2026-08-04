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

**Flat-fee projects** contribute a single `flat` line item of `flatFeeCents` regardless of hours; their time entries are still marked `invoiced` (so hours are captured) but do not multiply out.

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
- **AC-INV-003** — *Given* a flat-fee project with 20h logged and a $5,000 fee, *when* invoiced, *then* one `flat` line item of $5,000 appears (not 20×rate), and the 20h of entries are marked invoiced.
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

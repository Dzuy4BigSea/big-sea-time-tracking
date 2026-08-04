# 06 — Estimates

Estimates are quotes sent before work begins. They reuse the invoice line-item and totals engine but have no time-entry linkage and a simpler state machine.

## Model

- `Estimate` + `EstimateLineItem` (see [01](01-data-model.md)). Line items are `free_form`/`flat` only.
- Fields mirror an invoice: client, currency, number (from `account.estimateNumberSeq`), subject, notes, terms, discount, tax1/tax2, subtotal/total (same math as [05](05-invoicing.md)).

## State machine

```
draft ──send──▶ sent ──▶ accepted
                  │
                  └────▶ declined
```
- `draft → sent`: assigns number, sets `publicToken`, records `sentAt`.
- `sent → accepted` / `sent → declined`: recorded by an internal user (phase 1 has no client-facing accept button; the public link is read-only).
- Numbers unique per account, no reuse.

## Convert to invoice

- An `accepted` (or `sent`) estimate can be **converted** to a `draft` invoice.
- Conversion copies client, currency, line items, discount, tax, subject, notes into a new draft invoice and sets `invoice.createdFromEstimateId`.
- Conversion does **not** attach time entries (invoice starts as free-form; the user may still add tracked time afterward).
- An estimate may be converted at most once; the resulting invoice link is shown on the estimate.

## Acceptance criteria

- **AC-EST-001** — *Given* a draft estimate with line items, *when* sent, *then* it gets a sequential number, `publicToken`, `sentAt`, status `sent`.
- **AC-EST-002** — *Given* a sent estimate, *when* marked accepted, *then* status is `accepted`; marking declined instead sets `declined`.
- **AC-EST-003** — *Given* an accepted estimate, *when* converted, *then* a new `draft` invoice exists with identical line items/totals and `createdFromEstimateId` set.
- **AC-EST-004** — *Given* an already-converted estimate, *when* conversion is attempted again, *then* it is rejected and the existing invoice link is returned.
- **AC-EST-005** — *Given* an estimate and an invoice sent in the same account, *when* their numbers are inspected, *then* they draw from **separate** sequences (estimate seq vs invoice seq).
- **AC-EST-006** — *Given* the same subtotal/discount/tax inputs, *when* estimate totals and invoice totals are computed, *then* they are byte-for-byte identical (shared engine).

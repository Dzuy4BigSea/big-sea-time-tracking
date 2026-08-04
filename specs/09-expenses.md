# 09 — Expenses

In active use at Big Sea (moved in-scope). Gated by the `expense_tracking` module.

## Model

`Expense` + `ExpenseCategory` ([01](01-data-model.md)). An expense belongs to a user, project, and category, on a `spentDate`.

## Behavior (observed)

- **List** (`Expenses`): grouped by week, each row shows date · Project [code] (Client) · **Category** · Billable badge · notes · amount · **receipt paperclip** (if attached) · **lock icon** (when invoiced). Weekly subtotal.
- Tabs: **All expenses** · **Categories**. "+ Track expenses". Teammates dropdown (view others').
- **Categories** are account-managed; may be flat-amount or unit-based (e.g. mileage: unit × unitPrice).
- **Billable** expenses flow into invoices as line items with `kind='expense'`, optionally with a **markup %** (observed: "$29.00 + 20% markup").
- **Receipts**: image/PDF attachment per expense.
- **Locking**: an invoiced expense is locked (like time entries) and joins the uninvoiced→invoiced flow.
- **Reimbursement**: account policy (Big Sea: reimbursement requests disabled).

## Acceptance criteria

- **AC-EXP-001** — *Given* a billable expense of $29.00 with 20% markup, *when* added to an invoice, *then* the line item amount is $34.80.
- **AC-EXP-002** — *Given* a unit-based category (mileage $0.65/mi) and 100 mi, *when* the expense is saved, *then* `totalCents = 6500`.
- **AC-EXP-003** — *Given* an invoiced expense, *when* edited or deleted, *then* it is rejected (locked, like time — **INV-3**).
- **AC-EXP-004** — *Given* a billable, un-invoiced expense, *when* an invoice is generated "from tracked time & expenses" for that client/range, *then* the expense appears as an `expense` line item and is marked invoiced.
- **AC-EXP-005** — *Given* `expense_tracking=off`, *when* a user navigates to expenses, *then* it is hidden/404 (module gate).
- **AC-EXP-006** — *Given* an expense with a receipt, *when* the invoice PDF is generated with "attach receipts" on, *then* the receipt is included.

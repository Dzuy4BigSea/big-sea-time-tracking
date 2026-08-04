# 07 — Reporting & Exports

Reports are read-only aggregations over time entries and invoices. All respect the actor's permission scope (a member sees only their own data). All accept a date range and are exportable to CSV.

## Reports in scope

### 1. Time report
Grouped by one of: client, project, task, person, or team (all people). Columns: hours (billable / non-billable / total), billable amount. Supports filters (client, project, person, billable flag) and the chosen group-by. Includes a total row.

### 2. Project budget / analysis report
Per project: budget, spent (hours or fees or cost per `budgetMethod`), remaining, % used, and — for fee/cost budgets — billable amount vs internal cost (**margin**). Flags over-budget projects.

### 3. Uninvoiced report
All billable, un-invoiced entries grouped by client/project, with total uninvoiced amount — the "money left on the table" view. This is the on-ramp to invoice creation.

### 4. Invoice report (A/R)
Invoices in range by status: total invoiced, total paid, total outstanding (due), overdue amount (due date < today and not paid). Grouped by client. Aging buckets: current, 1–30, 31–60, 60+ days overdue.

### 5. Payments report
Payments in range by method/client, with totals.

## Exports

- Every report exports to CSV with a stable column order matching the on-screen table.
- Detailed time export: one row per time entry (date, person, client, project, task, notes, hours, billable, amount).
- Amounts export in major units with 2 decimals and an explicit currency column; hours as decimal.

## Correctness rules

- Aggregations use the same integer-cents math as invoicing; the sum of a report's billable amounts for a set of entries must equal what those entries would total on an invoice (no rounding divergence).
- Reports never include entries from other accounts or outside the actor's permission scope.
- "Uninvoiced" in the report uses the exact same predicate as [05](05-invoicing.md) §Uninvoiced pool.

## Acceptance criteria

- **AC-RPT-001** — *Given* time entries across two projects, *when* the time report groups by project for the range, *then* each project's total hours and billable amount equal the sum of its entries, and the grand total equals the sum of both.
- **AC-RPT-002** — *Given* a member runs the time report, *when* results return, *then* only their own entries appear (scope enforced).
- **AC-RPT-003** — *Given* a project with a 40h budget and 46h logged, *when* the budget report runs, *then* it shows 115% used and flags the project over-budget.
- **AC-RPT-004** — *Given* the same billable entries, *when* their total appears in the uninvoiced report and again when pulled onto an invoice, *then* the two amounts are identical (no rounding drift).
- **AC-RPT-005** — *Given* an invoice due 40 days ago and unpaid, *when* the A/R report runs, *then* its due amount falls in the "31–60 days overdue" bucket.
- **AC-RPT-006** — *Given* any report, *when* exported to CSV, *then* the CSV column order and totals match the on-screen table and include an explicit currency column.
- **AC-RPT-007** — *Given* a fee-budget project, *when* the analysis report runs with cost rates set, *then* margin = billable amount − internal cost is computed and displayed.
- **AC-RPT-008** — *Given* an entry that has been invoiced, *when* the uninvoiced report runs, *then* that entry does not appear.

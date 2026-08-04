# 13 — Migration off Harvest

Big Sea is moving off Harvest, so **data migration is a first-class feature, not an afterthought**. The clone must import Big Sea's full history so the team and clients experience continuity. This spec covers the import pipeline, source formats, field mappings, ordering, ID preservation, validation, and cutover.

## Goals & principles

- **Lossless where it matters:** all time entries, invoices, payments, clients/projects/tasks/people, expenses, recurring profiles, and retainers come across with amounts, dates, and relationships intact.
- **Referential integrity preserved:** every imported row keeps a stable link to its parent (client→project→time entry→invoice line).
- **Idempotent & re-runnable:** running the import twice does not duplicate rows (keyed on the Harvest source id).
- **Auditable dry-run first:** every import runs in `--dry-run` producing a report before any write.
- **Numbers preserved:** invoice/estimate numbers are imported as-is; the account number sequences are seeded to `max(imported)+1` so new invoices continue the series without collision (**INV-6**).

## Source of truth: Harvest data

Two complementary sources — use both:

1. **Harvest API v2** (`https://api.harvestapp.com/v2/…`) — authoritative, typed, paginated JSON for every entity. Preferred for completeness and relationships. Requires a personal access token + account id (admin generates in Harvest ID → Developers).
2. **CSV export** (Settings → Import/Export; per-list Export buttons) — fallback / spot-check, and the path if API access is unavailable.

> Because API access needs an admin token the user must create, the importer accepts **either** a directory of Harvest CSV exports **or** live API credentials.

## Entity import order (dependency-driven)

Import in this order so foreign keys always resolve; each stage validated before the next:

```
1. Account settings + Modules + Preferences        (11)
2. Item types, Expense categories, Tasks           (global lookups)
3. People (+ effective-dated billable & cost rates) (02, 01)
4. Clients (+ contacts)                             (03, 01)
5. Projects (+ type, billable-rate method, budgets) (03)
6. Project task assignments + user assignments      (03)
7. Time entries                                     (04)
8. Expenses (+ receipts)                            (09)
9. Invoices → line items → payments                 (05)
10. Estimates (if module used)                       (06)
11. Recurring invoice profiles                       (10)
12. Retainers                                         (10)
13. Reconciliation & sequence seeding
```

## Key mappings (Harvest → clone)

| Harvest source | Clone target | Notes |
|---|---|---|
| Project `bill_by` + `hourly_rate`/`fee` | `projectType` + `billableRateMethod` + rate/fees | Map `bill_by = Project/Task/People/none` and `is_fixed_fee`, `is_billable` to the two-level model ([03](03-clients-projects-tasks.md)) |
| Person `default_hourly_rate`, `cost_rate` + rate history | `PersonBillableRate` / `PersonCostRate` rows | Preserve **effective date ranges**; if API exposes only current, import as a single open-ended row and flag |
| Person `roles` | `roleTags` (labels) | Not permissions |
| Person `access_roles`/permission | `permissionProfile` (+ overrides) | Map to the 6 profiles ([02](02-auth-accounts.md)) |
| Task `billable_by_default`, `default_hourly_rate` | Task defaults + `autoAddToNewProjects` | "Common" vs "Other" |
| Client contacts | `ClientContact[]` | Preserve `(invoices)` recipient flag |
| Invoice `number`, `state`, dates, currency | Invoice as-is | Keep number; map state to stored status + derive display badge |
| Invoice line `kind`, `item_type` (category) | line `kind` + `itemTypeId` | Create ItemTypes; keep `Service`/`Product` defaults |
| Time entry `spent_date`, `hours`, `is_billable`, `billable_rate`, `is_locked`, `is_closed`, `invoice_id` | TimeEntry + `lockState` + `invoiceLineItemId` | Preserve invoiced/locked state; **do not re-derive** rate on locked entries — import the historical `billable_rate` verbatim |
| Expense `receipt`, `total_cost`, `units`, `is_billable`, `is_locked`, `invoice_id` | Expense (+ receipt file) | Download & re-store receipts |
| Payment | Payment | Sum must equal invoice `paid` |
| Estimate | Estimate | Only if `estimates` module enabled |
| — (Harvest ids) | `sourceHarvestId` column on each imported row | For idempotency + audit |

## Money & time fidelity

- Convert Harvest decimal amounts to **integer cents**; assert no precision loss (`round(amount*100)` equals source to the cent).
- Convert Harvest decimal hours to **integer minutes** (`round(hours*60)`).
- Preserve per-invoice currency; costs in account base currency.

## Validation & reconciliation (must pass before cutover)

Produce a reconciliation report comparing source vs imported totals:

- Count parity per entity (people, clients, projects, tasks, time entries, expenses, invoices, line items, payments).
- **Financial parity:** total invoiced, total paid, total outstanding match Harvest's dashboard to the cent.
- **Hours parity:** total tracked hours per person per month match Harvest reports.
- **No orphans:** every time entry/expense/line item/payment resolves to an existing parent.
- **No double-invoicing:** no time entry/expense maps to more than one non-void invoice (**INV-4**).
- **Number continuity:** imported invoice numbers unique; sequence seeded to `max+1`.

## Cutover plan

1. Dry-run import → reconciliation report → review discrepancies.
2. Freeze Harvest writes (announce a cutover window).
3. Final delta import (entries/invoices created since the dry-run).
4. Re-run reconciliation; sign off on financial + hours parity.
5. Seed number sequences; flip DNS/app to the clone.
6. Keep Harvest read-only for a grace period as reference.

## Acceptance criteria

- **AC-MIG-001** — *Given* a Harvest CSV export (or API pull), *when* the importer runs `--dry-run`, *then* it writes nothing and produces a reconciliation report of counts + financial/hours parity.
- **AC-MIG-002** — *Given* the import runs twice, *when* the second run completes, *then* no entity is duplicated (idempotent on `sourceHarvestId`).
- **AC-MIG-003** — *Given* imported invoices, *when* totals are summed, *then* total invoiced/paid/outstanding equal Harvest's figures to the cent.
- **AC-MIG-004** — *Given* a time entry that was invoiced in Harvest, *when* imported, *then* its `lockState='invoiced'`, its historical `billableRateCents` is preserved (not re-derived), and it links to the imported invoice line.
- **AC-MIG-005** — *Given* a person with a rate history, *when* imported, *then* effective-dated rate rows are created with non-overlapping ranges, and a mid-history time entry resolves to the correct rate.
- **AC-MIG-006** — *Given* imported invoice numbers with max N, *when* a new invoice is created post-migration, *then* it is numbered N+1 with no collision.
- **AC-MIG-007** — *Given* billable expenses with receipts, *when* imported, *then* receipts are downloaded and re-attached, and markup/billable flags are preserved.
- **AC-MIG-008** — *Given* recurring profiles and retainers, *when* imported, *then* next-issue dates / balances match Harvest and generation resumes correctly.
- **AC-MIG-009** — *Given* the reconciliation report, *when* any parity check fails, *then* the report flags the exact rows and the cutover is blocked until resolved.

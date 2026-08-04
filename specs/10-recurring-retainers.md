# 10 — Recurring Invoices & Retainers

Both are heavily used at Big Sea (dozens of monthly recurring profiles; 9 ongoing retainers). Required for a drop-in replacement.

## Recurring invoices

A **RecurringInvoiceProfile** ([01](01-data-model.md)) generates invoices on a schedule.

- Fields: Client, Subject, template line items, frequency + interval (e.g. every 1 month), next issue date, status (`active`/`paused`), and the same billing fields as an invoice (payment term, tax, notes).
- List columns (observed): **Client · Invoice subject · Next invoice (date + "every month") · Amount**; status shows **Paused** when paused.
- Generation: a scheduled job, on `nextIssueDate`, clones the template into a new invoice (as `draft` or auto-sent per profile setting), then advances `nextIssueDate` by the interval.
- "Create recurring" is also reachable from an existing invoice's Actions menu (seeds a profile from that invoice).
- Pausing stops generation without deleting the profile.

### Acceptance criteria
- **AC-REC-001** — *Given* an active monthly profile with `nextIssueDate = today`, *when* the generation job runs, *then* exactly one invoice is created from the template and `nextIssueDate` advances one month.
- **AC-REC-002** — *Given* a paused profile, *when* the job runs, *then* no invoice is generated.
- **AC-REC-003** — *Given* the job runs twice for the same date (retry), *when* it completes, *then* only one invoice exists for that period (idempotent).
- **AC-REC-004** — *Given* an existing invoice, *when* "Create recurring" is chosen, *then* a profile is created whose template matches that invoice's line items.

## Retainers

A **Retainer** ([01](01-data-model.md)) is a prepaid balance a client draws down.

- Scope: tied to a Client and optionally a Project (or "All projects").
- Balances: `depositCents` (prepaid), `drawnCents` (consumed), `balanceCents = deposit − drawn`.
- List (observed): **Ongoing retainers** show Client · Project · **Uninvoiced amount · Retainer balance**; **Archived retainers** show **Drawn balance**.
- Flow: client pays a deposit → balance increases; invoices applied against the retainer draw down the balance.
- **Retainer deposits are excluded** from revenue "total paid" metrics (dashboard note: "excluding retainer deposits").

### Acceptance criteria
- **AC-RET-001** — *Given* a retainer with $10,000 deposit and $0 drawn, *when* a $2,000 invoice is applied against it, *then* `drawnCents=200000`, `balanceCents=800000`.
- **AC-RET-002** — *Given* a retainer, *when* revenue "total paid" is computed, *then* the deposit is excluded from that figure.
- **AC-RET-003** — *Given* an application that would exceed the remaining balance, *when* attempted, *then* it is handled per policy (reject or allow negative per account setting) — default reject.
- **AC-RET-004** — *Given* a retainer scoped to "All projects", *when* uninvoiced amount is shown, *then* it aggregates across all of the client's projects.

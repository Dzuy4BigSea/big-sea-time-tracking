# Harvest Clone

A time-tracking + invoicing app modeled on Harvest, built with a **spec → validation → QA** agentic workflow.

## The spec

The full specification lives in [`specs/`](specs/). Start with [specs/00-overview.md](specs/00-overview.md) — it evaluates what Harvest does, picks the stack, and lists the global invariants. Each subsequent file specifies one domain as testable **Given/When/Then** acceptance criteria (`AC-###`).

| # | File | Domain |
|---|---|---|
| — | [findings](specs/findings.md) | **Ground truth from the live account — read first; overrides older text** |
| 00 | [overview](specs/00-overview.md) | Product eval, stack, invariants, conventions |
| 01 | [data-model](specs/01-data-model.md) | Entities, schema, enums |
| 02 | [auth-accounts](specs/02-auth-accounts.md) | Auth, **6 permission profiles** |
| 03 | [clients-projects-tasks](specs/03-clients-projects-tasks.md) | Projects, budgets, **two-level billing + effective-dated rate resolution** |
| 04 | [time-tracking](specs/04-time-tracking.md) | Timers, timesheets, approval (module), locking |
| 05 | [invoicing](specs/05-invoicing.md) | Invoices, payments, **revised state machine**, uninvoiced pool |
| 06 | [estimates](specs/06-estimates.md) | Estimates (module, off at Big Sea) |
| 07 | [reporting](specs/07-reporting.md) | Report families & CSV exports |
| 08 | [nonfunctional](specs/08-nonfunctional.md) | Security, performance, a11y, i18n |
| 09 | [expenses](specs/09-expenses.md) | Expenses, categories, receipts, markup |
| 10 | [recurring-retainers](specs/10-recurring-retainers.md) | Recurring invoices & retainers |
| 11 | [settings-modules-preferences](specs/11-settings-modules-preferences.md) | Feature flags, account preferences, billing |
| 12 | [ui-fidelity](specs/12-ui-fidelity.md) | Screen-by-screen layout catalogue |
| 13 | [migration](specs/13-migration.md) | Data migration off Harvest (import, mappings, cutover) |

## How the agentic loop uses this

1. **Spec agent** owns `specs/*`. Any behavior change starts as an edit here (new/changed `AC-###`).
2. **Build agent** implements one domain at a time, in dependency order (below), against its spec file. Definition of done in [00-overview §5](specs/00-overview.md).
3. **Validation agent** diffs the implementation against the spec: schema vs [01](specs/01-data-model.md), and each `AC-###` and `INV-#` invariant confirmed.
4. **QA agent** writes/runs Playwright specs whose test names embed the `AC-###` id, so coverage maps 1:1 to acceptance criteria.

## Suggested build order (dependency-driven)

```
01 data-model  →  02 auth  →  03 clients/projects/tasks (rate resolution)
      →  04 time-tracking  →  05 invoicing  →  06 estimates  →  07 reporting
08 non-functional is cross-cutting: asserted throughout, hardened last.
```

Rationale: nothing bills correctly until **rate resolution** (03) is right; invoicing (05) depends on time entries (04); estimates (06) reuse the invoice engine; reporting (07) reads everything.

## Global invariants (never violate — see [00](specs/00-overview.md))

- **INV-1** money is integer minor units, never float
- **INV-2** billable rate is derived, not typed
- **INV-3** invoiced/approved entries are immutable
- **INV-4** no entry on two non-void invoices
- **INV-5** all access scoped to `accountId`
- **INV-6** invoice/estimate numbers unique, never reused
- **INV-7** only guarded state transitions allowed

## Scope

**In:** time tracking, timesheets/approval, clients/projects/tasks, invoicing, payments, estimates, reporting.
**Out (this phase):** expenses, recurring invoices, online payment capture, client portal login, mobile/desktop apps, third-party integrations. The data model leaves extension points for these — see [01 §Extension points](specs/01-data-model.md).

# Harvest Clone — Product & Technical Overview

> **Spec set version:** 0.2 (revised against the live Big Sea account — see [findings.md](findings.md))
> **Scope:** A **high-fidelity replica** of Harvest for migration off the product. Time tracking, Expenses, Team/permissions, Clients/Projects/Tasks, Invoicing (incl. **Recurring** & **Retainers**), Reporting, and a Client dashboard. Estimates and Timesheet approval are built as **modules, off by default** (Big Sea doesn't use them). Integrations (Xero/Stripe/Google/Forecast) and native mobile/desktop apps are out of scope this phase.
> **Why fidelity matters:** Big Sea is migrating off Harvest and needs continuity for its team and clients — the clone should look and behave like Harvest so day-to-day use and client-facing artifacts (invoices) carry over with minimal disruption. See [12-ui-fidelity.md](12-ui-fidelity.md).
> **Purpose:** This document set is the source of truth for a spec → validation → QA agentic build. Every feature file states behavior as testable **Given/When/Then** acceptance criteria (`AC-###`) that a validation agent can check off and a QA agent can automate. **Where [findings.md](findings.md) (live observation) conflicts with older text, findings win.**

---

## 1. What Harvest is (evaluation)

Harvest (harvestapp.com) is a SaaS product for professional-services teams (agencies, consultancies, freelancers) that answers two business questions:

1. **"Where did our time go?"** — lightweight time tracking against clients/projects/tasks, with budgets and reporting.
2. **"Did we get paid for it?"** — turning tracked time into invoices, sending them, and recording payment.

Its durable advantage is not any single feature; it's the **tight loop between tracked time and billable revenue**. Time entries carry a billable flag and an hourly rate resolved from the project's billing method; those entries flow — uninvoiced — into an invoice with one click, and once invoiced they lock so the numbers can't drift. A clone that gets this loop right is a real Harvest clone; one that treats time tracking and invoicing as two unrelated modules is not.

### How Harvest works — the core model

```
Account (workspace)
 ├── Users (roles: Administrator, Manager, Member)
 ├── Clients
 │    └── Projects  (billing method + budget method live here)
 │         └── Task assignments (which global Tasks apply, at what rate)
 ├── Tasks (global list, e.g. "Design", "Development")
 ├── Time entries  (user × project × task × date, hours + billable + rate)
 ├── Invoices  (drawn from uninvoiced time, or free-form line items)
 └── Estimates (quote → convert to invoice)
```

### The mechanics that matter (and are easy to get wrong)

- **Rate resolution.** The billable rate on a time entry is *derived*, not typed. A project's **billing method** decides the source: by-project rate, by-task rate, by-person rate, or flat fee / non-billable. Getting this resolution order right is the crux of correct billing. See [04-time-tracking.md](04-time-tracking.md) §Rate resolution.
- **One running timer per user.** Starting a timer stops any other running timer for that user. Time can be entered two ways — a live start/stop **timer**, or a typed **duration** (`1.5` or `1:30`).
- **Locking.** A time entry becomes immutable when it is (a) pulled onto a sent invoice, or (b) inside an approved/locked timesheet period. Locked entries cannot be edited or deleted.
- **Invoice state machine.** `draft → open → paid`, with `closed`/`written-off` as terminal side states and partial payments accumulating toward the total. State transitions are guarded; see [05-invoicing.md](05-invoicing.md).
- **Uninvoiced pool.** Any billable, un-invoiced time entry is available to be added to an invoice. Once added, it's tagged with the invoice id and leaves the pool. This prevents double-billing and is a primary QA target.
- **Money is integer minor units.** All monetary amounts are stored as integer cents in a single currency per invoice. No floats. Hours are stored as integer minutes internally and presented as decimal hours.

### What we are deliberately deferring

Expenses, recurring invoices, online payment capture (Stripe/PayPal), estimates approval by client link, team capacity/scheduling (Forecast), mobile/desktop apps, and third-party integrations. Estimates are **included** (they share the invoice engine and are cheap to add); expenses are **excluded** but the data model leaves room (see [01-data-model.md](01-data-model.md) §Extension points).

---

## 2. Personas

| Persona | Role in app | Primary jobs |
|---|---|---|
| **Owner / Administrator** | `admin` | Configure account, manage users & rates, see all data, manage invoices, run all reports. |
| **Project Manager / Manager** | `manager` | Manage assigned projects, approve timesheets, view team time & budgets, (optionally) manage invoices. |
| **Team Member** | `member` | Track own time against assigned projects, submit timesheets, see own reports only. |
| **Client (external)** | no login (phase 1) | Receives invoices as a shareable public link / PDF. No authenticated portal in this phase. |

Full permission matrix: [02-auth-accounts.md](02-auth-accounts.md).

---

## 3. Recommended tech stack (and why)

Chosen for a spec/validation/QA **agentic** workflow: one typed language end-to-end, a schema that is itself a spec, and first-class automated testing.

| Concern | Choice | Why it fits agentic dev |
|---|---|---|
| Language | **TypeScript** (strict) | One language client→server; types are machine-checkable contracts agents can validate against. |
| Framework | **Next.js (App Router)** | Single codebase, server actions + route handlers, colocated UI. Less cross-repo drift for agents. |
| DB | **PostgreSQL** | Transactions (critical for invoicing/locking), decimal-safe money, mature. |
| ORM / schema | **Prisma** | `schema.prisma` is a single declarative source of truth for the data model — ideal validation anchor. |
| Auth | **Auth.js (NextAuth)** — email/password + sessions | Standard, testable, self-hosted. |
| Validation | **Zod** | Runtime schemas mirror the spec's field constraints; shareable between client and server. |
| UI | **React + Tailwind + shadcn/ui** | Accessible primitives, fast to assemble, predictable DOM for QA selectors. |
| Money/time | **dinero.js** (or integer-cents helpers) + **Luxon** | No float money; explicit timezone handling. |
| Unit/integration tests | **Vitest** | Fast; validation agent runs these per feature. |
| E2E / QA | **Playwright** | Drives acceptance criteria as browser tests; stable `data-testid` selectors (see §5). |
| Background jobs | **Simple queue (pg-boss)** or cron route | Invoice reminders, timesheet nudges. |

**Architecture:** modular monolith. Domain modules — `accounts`, `time`, `projects`, `invoicing`, `reporting` — each expose a service layer (pure functions over the DB) that the UI and API both call. Business rules (rate resolution, locking, invoice state) live **only** in the service layer, never in components. This gives the validation agent one place to assert each rule and the QA agent a clean seam for integration tests.

```
app/            → Next.js routes (UI + route handlers)
modules/
  accounts/     → users, roles, account settings
  clients/
  projects/     → projects, tasks, assignments, rate resolution
  time/         → entries, timers, timesheets, approval
  invoicing/    → invoices, estimates, line items, payments, state machine
  reporting/    → aggregations, exports
  shared/       → money, dates, ids, permissions
prisma/schema.prisma
tests/          → vitest unit/integration
e2e/            → playwright acceptance specs (mirror AC-### ids)
```

---

## 4. Non-negotiable invariants (global — QA must assert continuously)

- **INV-1** Money is never a float. Amounts are integer minor units; currency is explicit per invoice.
- **INV-2** A time entry's billable rate is derived from the project billing method at read time of invoice creation, never hand-typed by a member.
- **INV-3** A time entry that is invoiced or inside a locked timesheet period is immutable (no edit, no delete, no re-invoice).
- **INV-4** No time entry may appear on more than one non-void invoice.
- **INV-5** Every mutation is scoped to the actor's `accountId`; cross-account reads/writes are impossible (multi-tenant isolation).
- **INV-6** Invoice/estimate numbers are unique per account and never reused.
- **INV-7** Every state transition is guarded by the state machine; illegal transitions are rejected, not silently ignored.

---

## 5. Conventions for the agentic workflow

- **Acceptance-criteria IDs.** Each criterion is `AC-<DOMAIN>-<n>` (e.g. `AC-TIME-014`). E2E test names must embed the id so the QA agent can map test→spec.
- **Test selectors.** Every interactive element carries `data-testid` in kebab-case matching the spec's named element.
- **Definition of done** (per feature): schema migrated → service functions + Zod schemas → UI → unit tests green → Playwright specs for every `AC` green → validation agent confirms each `AC` and invariant.
- **Seed data.** A deterministic seed (`prisma/seed.ts`) provides two accounts, three users per role, clients, projects with each billing method, and sample time entries — so QA runs are reproducible.

## 6. File index

| File | Domain |
|---|---|
| [findings.md](findings.md) | **Ground truth from the live account — read first; overrides older text** |
| [00-overview.md](00-overview.md) | This file — product eval, stack, invariants |
| [01-data-model.md](01-data-model.md) | Entities, relationships, schema, enums (revised) |
| [02-auth-accounts.md](02-auth-accounts.md) | Auth, accounts, **6 permission profiles** |
| [03-clients-projects-tasks.md](03-clients-projects-tasks.md) | Clients/projects/tasks, budgets, **two-level billing + effective-dated rate resolution** |
| [04-time-tracking.md](04-time-tracking.md) | Time entries, timers, timesheets, approval (module), locking |
| [05-invoicing.md](05-invoicing.md) | Invoices, payments, **revised state machine**, uninvoiced pool |
| [06-estimates.md](06-estimates.md) | Estimates (module, off at Big Sea) |
| [07-reporting.md](07-reporting.md) | Report families & exports |
| [08-nonfunctional.md](08-nonfunctional.md) | Security, performance, a11y, i18n, audit |
| [09-expenses.md](09-expenses.md) | Expenses, categories, receipts, markup |
| [10-recurring-retainers.md](10-recurring-retainers.md) | Recurring invoices & retainers |
| [11-settings-modules-preferences.md](11-settings-modules-preferences.md) | Modules (feature flags), account preferences, billing |
| [12-ui-fidelity.md](12-ui-fidelity.md) | Screen-by-screen layout catalogue for the visual replica |
| [13-migration.md](13-migration.md) | Data migration off Harvest (import pipeline, mappings, cutover) |

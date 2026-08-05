# Build Progress

Running status of the Harvest clone build. Updated as we go. Pairs with the specs in [`specs/`](specs/) and the build order in [README](README.md).

_Last updated: 2026-08-04._

## Current status

**Phase:** Foundation / core service logic. **Database live on Supabase** (schema pushed, constraints applied, seeded, verified). Pure business-logic modules landing with tests. No app UI yet.

**Test suite:** 66 passing across 9 files. `tsc --noEmit` clean.

## Build order checklist

Dependency order from the README. Status: ✅ done · 🟡 in progress · ⬜ not started.

| # | Area | Status | Notes |
|---|---|---|---|
| — | Spec set (findings + 00–13) | ✅ | Revised against live account |
| — | Prisma schema + seed | ✅ | `prisma validate` clean; seed type-checks |
| 01 | Data model | ✅ | Schema mirrors spec |
| 02 | Auth / permissions | 🟡 | `can()` capability layer ✅ + tests; auth flows (login/session/2FA), tenant-isolation enforcement ⬜ |
| 03 | Projects / **rate resolution** | 🟡 | `resolveRate` ✅ + tests; project/task/client CRUD services ⬜ |
| 04 | Time tracking | 🟡 | duration helpers ✅; time-entry logic (timer, one-running-timer plan, edit/lock guards) ✅ + tests; DB service wiring ⬜; timesheets/approval (module off) ⬜ |
| 05 | Invoicing | 🟡 | **logic layer complete**: totals ✅, state machine ✅, uninvoiced pool ✅, payments ✅, line-item grouping ✅. Remaining: DB wiring/services (repos, transactions) ⬜ |
| 06 | Estimates | ⬜ | Module off at Big Sea — low priority |
| 07 | Reporting | ⬜ | |
| 08 | Non-functional | ⬜ | Tenant-isolation tests, authz, audit |
| 09 | Expenses | ⬜ | |
| 10 | Recurring / retainers | ⬜ | |
| 11 | Settings / modules | ⬜ | |
| 12 | UI (Next.js app) | ⬜ | Not scaffolded yet |
| 13 | Migration importer | ⬜ | Needs Supabase + API/CSV |
| — | Shared helpers (money, duration) | ✅ | + tests |

## Completed modules

| Module | Purpose | Tests |
|---|---|---|
| `modules/shared/money.ts` | integer-cents math, half-up rounding, percentOf | 3 |
| `modules/shared/duration.ts` | parse/format durations, timer rounding | 9 |
| `modules/projects/resolveRate.ts` | two-level, effective-dated rate resolution | 12 |
| `modules/invoicing/totals.ts` | invoice subtotal/discount/tax/total | 7 |

## Decisions log

- **Stack:** Next.js + TypeScript + PostgreSQL + Prisma + Zod + Auth.js; Vitest (unit) + Playwright (E2E, later).
- **Business rules live in the service layer** (`modules/*`), never in Prisma or components — pure functions, DB-free tests.
- **Hosting / review:** app → **Vercel** (per-PR preview URLs = the human-review home); DB → **Supabase**.
- **DB connection:** Supabase **Session pooler** (`aws-0-us-east-2.pooler.supabase.com:5432`, IPv4). The direct host (`db.*.supabase.co`) is **IPv6-only** and unreachable on IPv4 networks. Schema applied via **`prisma db push`** (not `migrate` — the `postgres` role can't create the shadow DB `migrate dev` needs). Constraints applied via `prisma db execute`.
- **Modules on at Big Sea:** time, expenses, team, invoices, client dashboard. **Off:** timesheet approval, estimates, activity log — build these but deprioritize.
- **Commit cadence:** auto commit+push each tested increment to `main`.

## Parking lot — revisit before/at these phases

Issues deferred on purpose, with where to pick them up.

- **[DB] No migration history** — schema is applied via `prisma db push` (no `prisma/migrations/`). Before production, adopt real migrations (baseline the current schema; configure a shadow DB or use `db push` only for dev). Constraints in `prisma/sql/constraints.sql` must be re-applied whenever the schema is recreated (they are applied via `prisma db execute`, ✅ done on the current Supabase DB).
- **[05] `discountBeforeTax` is a param (default true), not persisted** — decide whether it's an Account setting or per-invoice; add to schema. → invoicing phase.
- **[03] Effective-dated *task* billable rates not modeled** — task rate currently = per-project assignment override ?? task default (no date ranges). Person rates ARE effective-dated. Confirm whether Harvest date-ranges task/project rates too. → rate phase.
- **[05] Money columns are 32-bit `Int` cents** (~$21M/row ceiling) — fine for invoices; revisit `BigInt` if any single stored amount could exceed that. → before production.
- **[Seed] `InvoiceAppearance` / `InvoiceLabels` not seeded** — models exist; add demo rows when the invoice renderer needs them. → invoice UI phase.
- **[UI] Multi-invoice client portal (client login) not captured** — needs a client account; single-invoice payment view is captured. → client-dashboard phase.
- **[07] Activity log** — Premium, disabled at Big Sea; not modeled in detail. → reporting phase (internal audit log via `AuditLog` still needed).
- **[Deploy] Ops/backup section missing from spec** — add Vercel+Supabase deploy steps and mandatory DB backups. → before first review deploy.

## Resolved (spec bugs caught while building)

- **person-rate fallback order** — spec had person-default before per-project override; corrected so the override wins ([specs/03](specs/03-clients-projects-tasks.md)). Fixed 2026-08-04.
- **AC-TIME-004 rounding example** — `52 → 60` was wrong (52 is nearer 45); corrected to `53 → 60, 52 → 45` ([specs/04](specs/04-time-tracking.md)). Fixed 2026-08-04.

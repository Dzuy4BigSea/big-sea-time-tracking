# Build Progress

Running status of the Track2 build (time-tracking + invoicing app, modeled on Harvest). Updated as we go. Pairs with the specs in [`specs/`](specs/) and the build order in [README](README.md).

_Last updated: 2026-08-08._

## ▶ Resume here (next session)

**Track2 is a working, deployed, authenticated app with the full Harvest history migrated in.** Live at `big-sea-time-tracking.vercel.app` (alias `track2.bigseabridge.com`). Sign in with `dzuy@bigsea.co` or `andi@bigsea.co` (admins). Everything is committed + pushed to `main`; `tsc` + `next build` green; **227 unit tests pass**.

### What's done (since 2026-08-06)
- **Invoicing depth:** activity/history log, Actions menu (write-off / duplicate / resend / manual Xero copy), edit + blank composer, print/PDF, delete payment / delete sent invoice, **Configure suite** (renameable field labels, editable email messages, item types, sender addresses).
- **Outbound email:** SendGrid pipeline + encrypted-key admin UI; invoice-sent, payment-receipt, overdue-reminder templates wired to the send paths.
- **Multi-brand (spec 16 + 18):** per-company brand console — company-tabbed Integrations, per-entity branding/accent, sender identity, **email theming + per-company invoice language**; money/branding/Xero already route by the invoice's business entity.
- **Team:** member detail hub (Basic / Rates / Assigned projects / Assigned people / Permissions / Security) with **granular per-user permission overrides enforced everywhere**; Members **week view** (hours / utilization / capacity) + Assignments tab.
- **Global cross-entity search** in the top bar; **dashboard KPI widgets**; **"Purpose built by Big Sea"** footer.
- **PRODUCTION MIGRATION COMPLETE (Harvest → Track2, `acc_demo`):** demo data cleared; **594 clients, 970 contacts, 581 tasks, 130 people, 2,649 projects, 388,607 time entries, 715 expenses, 7,788 invoices** (with reconstructed activity/status), and the **real assignment roster** (31,646 user + 24,234 task assignments, PM flags + rates). Tooling is resumable/idempotent — see the `migration-progress` memory + [MIGRATION-RUNBOOK.md](MIGRATION-RUNBOOK.md) + `scripts/*`.
- **Real-data screen audits/rebuilds:** every core list/detail now **aggregates in the DB** (no loading 388k rows) with filters/sort/pagination — Team, Projects (list + detail), Clients, Tasks, Invoices (list, incl. fixed empty chart + controls), Reports (Time + Profitability). Shared reference-line **ColumnChart**.
- **Mobile step 1:** responsive shell (off-canvas sidebar drawer + hamburger below `lg`, responsive padding) — [spec 20](specs/20-mobile-responsive.md).

### What's open / next (tracked, not lost)
- **Mobile step 2+** ([spec 20](specs/20-mobile-responsive.md)): per-table `overflow-x-auto` + hide-secondary-columns-under-`sm` (row-action dropdowns need `overflow-visible` — needs care); form stacking; public/print invoice on a phone; **visual QA at 375px not yet done**.
- **UI loose ends** ([spec 17](specs/17-ui-functional-audit.md) → "Open loose ends"): invoices **Balance sort** + **Columns chooser**; member-detail `?tab=` deep-links (referenced from Team Actions menu, may not be read yet); **Expenses screen** real-data audit pass; more **Reports** types (utilization, payments, uninvoiced) + charts on Profitability/Receivables.
- **Migration follow-ups** ([spec 19](specs/19-migration-followups.md)): PM-flag breadth (~90% is_project_manager — confirm intent); reconcile the **7 partially-paid invoices** vs Xero (#2072, #2645, #387523, #387747, #389700, #911, #996); **estimates** 403'd during backup (re-pull if wanted); **cost/billable-rate backfill** (project Costs column hidden, historical billable $ understates until then).
- **Ops:** separate **production Supabase** (Pro + backups) before this is the system of record; set `CRON_SECRET` to activate recurring-invoice cron; decide Vercel deployment protection.
- **Stale task list:** the harness TaskCreate list (#1–84) reflects the original build plan and is no longer maintained — these spec files + this doc are the source of truth.

**Heads-up for whoever picks this up:**
- Migration tooling: `scripts/migrate-staged.ts` (team→projects→timesheets→billing phases, resumable), `scripts/migrate-timesheets.mjs` (bulk 388k, fresh connection per year), `scripts/sync-assignments.mjs` (Harvest roster; needs `INTEGRATION_ENC_KEY`), `scripts/clear-demo-data.mjs` (guarded), `scripts/inspect-db.mjs`. Reconciliation logic in `modules/migration/reconcile.ts` (+ tests).
- Big lists/reports now use raw `$queryRaw` / `groupBy` aggregation — never `findMany` the full time-entry table.
- The `/i/[token]` + `/print/[id]` public views drop app chrome via `BARE_PREFIXES` in [app/layout.tsx](app/layout.tsx); the app shell is [components/Shell.tsx](components/Shell.tsx) (mobile drawer).
- Per-company resolution: [lib/appearance.ts](lib/appearance.ts), [lib/invoiceLabels.ts](lib/invoiceLabels.ts), [lib/messageTemplates.ts](lib/messageTemplates.ts), [modules/entities/resolveEntity.ts](modules/entities/resolveEntity.ts) all take an optional `entityId` and fall back entity → account → default.

## Current status

**Phase:** Feature build — entity CRUD. DB live on Supabase (migrations adopted); core logic tested; app deployed on Vercel with auth + multi-tenant scoping. Create forms landing for the core entities.

**Test suite:** 167 unit tests passing; `next build` + `tsc` clean. Write paths (time, timer, invoicing lifecycle, CRUD, expenses→invoice, retainers, recurring generation, estimate send/convert) integration-verified against the DB (then rolled back / reseeded).

## Build order checklist

Dependency order from the README. Status: ✅ done · 🟡 in progress · ⬜ not started.

| # | Area | Status | Notes |
|---|---|---|---|
| — | Spec set (findings + 00–13) | ✅ | Revised against live account |
| — | Prisma schema + seed | ✅ | `prisma validate` clean; seed type-checks |
| 01 | Data model | ✅ | Schema mirrors spec |
| 02 | Auth / permissions | 🟡 | **NextAuth v5** (credentials + JWT session carrying userId/accountId/profile) ✅, login page + middleware route protection ✅, **session-scoped tenancy across every page + action** (INV-5) ✅, `can()` capability layer ✅ + tests. Remaining: password reset, 2FA, invite/admin UI, capability enforcement in actions |
| 03 | Projects / **rate resolution** | 🟡 | `resolveRate` ✅ + tests; project/task/client CRUD services ⬜ |
| 04 | Time tracking | 🟡 | duration helpers ✅; time-entry logic (timer, one-running-timer, lock guards) ✅ + tests; **logTime + timer services** ✅ + DB integration-tested; **log-time form, start/stop timer UI, delete entry (lock-guarded)** ✅; **inline entry edit (duration + notes, lock-guarded)** ✅. Timesheets/approval (module off) ⬜ |
| 05 | Invoicing | ✅ | **core loop complete & live**: generateInvoice (pool→draft), sendInvoice (number/lock/token/seq-bump), recordPayment (partial/full/overpayment-guard), markInvoiceDraft (unlock) — all DB integration-tested + wired to UI. **Public client-facing view `/i/[token]`** ✅ (no-auth, bare layout, noindex; "View client link" on the internal detail). Remaining polish: taxes/discount UI on generate, per-account `InvoiceAppearance` (brand/logo), online payment |
| 06 | Estimates | ✅ | Full CRUD + lifecycle (draft/sent/accepted/declined), **separate number sequence** (AC-EST-005), **convert-to-invoice once** (AC-EST-003/004), shared totals engine. Module-gated (off at Big Sea → hidden). Public estimate view ⬜ |
| 07 | Reporting | ✅ | **Time**, **Profitability** (revenue vs effective-dated cost → margin), **Receivables** (A/R aging) ✅ live, tabbed. **CSV export** (detailed time entries, permission-gated) ✅ |
| 08 | Non-functional | ✅ | **Authz matrix tests** (full capability grid + overrides + scoping) + **DB-backed tenant-isolation suite** (`npm run test:integration`, INV-5 across all core models) ✅. Audit-log wiring ⬜ |
| 09 | Expenses | 🟡 | **Expense entry** ✅ (self-service; project/category/date/amount/markup/billable/notes, tenant-scoped) + **admin category management** ✅ (inline on /expenses). Receipts upload ⬜; expense→invoice line items ⬜ |
| 10 | Recurring / retainers | ✅ | **Retainers** (deposit/drawdown math + tests, uninvoiced aggregation, archive); **Recurring** (profiles, schedule math + tests, generate-due, create-from-invoice, pause/delete) + **Vercel Cron** `/api/cron/recurring` (needs `CRON_SECRET` env to activate) |
| 11 | Settings / modules | ✅ | **Settings** screen: preferences, **module toggles** (with nav/route gating, AC-MOD), expense categories, **invoice appearance** editor. Import/export ⬜ |
| 12 | UI (Next.js app) | 🟡 | App Router + Tailwind + Prisma singleton ✅; sidebar layout ✅; **global sticky top bar** (section title + "+ New" quick-create) ✅; **every sidebar screen live + core loop + auth**. **Full entity CRUD** (create + edit) for **Client / Task / Project / Person** ✅ — all permission-gated via `can()` in the action. **Expense entry** ✅. **Inline time-entry edit** ✅. **Client detail** (`/clients/[id]`) ✅. **Public invoice** (`/i/[token]`) ✅. **CSV export** ✅. Remaining: Settings screen, invoice-appearance theming, receipts upload |
| 13 | Migration importer | ⬜ | Needs Supabase + API/CSV |
| 14 | Integrations (Asana / Stripe / Xero) | ✅ | **Built** ([specs/14](specs/14-integrations.md)): admin **credential UI** `/settings/integrations` (encrypted at rest via `INTEGRATION_ENC_KEY`); **Stripe** public-invoice pay + verified idempotent webhook → recordPayment; **Xero** copy invoice-on-send + payment copy; **Asana** project/people import. Business logic unit-tested (crypto, webhook sig, mappers, import plan). **To go live:** set `INTEGRATION_ENC_KEY` + enter each provider's keys in the admin UI; provider REST calls need real credentials to exercise end-to-end |
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
- **DB connection:** **local** = Supabase **Session pooler** (`…pooler.supabase.com:5432`, IPv4); **Vercel (serverless)** = Supabase **Transaction pooler** (`:6543`, `?pgbouncer=true&connection_limit=1`). The direct host (`db.*.supabase.co`) is **IPv6-only** and unreachable on IPv4 networks. Schema applied via **`prisma db push`** (not `migrate` — the `postgres` role can't create the shadow DB `migrate dev` needs). Constraints applied via `prisma db execute`.
- **Deploy:** Vercel connected to the GitHub repo. Build works via `postinstall: prisma generate` + `binaryTargets ["native","rhel-openssl-3.0.x"]`. Live: `big-sea-time-tracking.vercel.app`; preview alias `track2.bigseabridge.com`.
- **Auth:** ✅ built (NextAuth v5, credentials against seeded users, session-scoped tenancy). Requires `AUTH_SECRET` env var in every environment (local `.env` + Vercel). Demo logins: `alice@bigsea.demo` (admin) / `frank@bigsea.demo` (member) / `zoe@globex.demo` (other tenant), password `password123`.
- **Modules on at Big Sea:** time, expenses, team, invoices, client dashboard. **Off:** timesheet approval, estimates, activity log — build these but deprioritize.
- **Commit cadence:** auto commit+push each tested increment to `main`.

## Parking lot — revisit before/at these phases

Issues deferred on purpose, with where to pick them up.

- **[DB] Migrations adopted** ✅ — `prisma/migrations/0_init` captures the full schema + the raw-SQL constraints; the live DB is baselined (`migrate resolve --applied 0_init`, no DDL run). **Workflow (Supabase blocks the shadow DB, so no `migrate dev`):** edit `schema.prisma` → `npm run migrate:new > prisma/migrations/<ts>_name/migration.sql` → review → `npm run migrate:deploy`. Migrations run manually against the **session pooler** (5432), not during the Vercel build (which uses the transaction pooler).
- **[05] `discountBeforeTax` is a param (default true), not persisted** — decide whether it's an Account setting or per-invoice; add to schema. → invoicing phase.
- **[03] Effective-dated *task* billable rates not modeled** — task rate currently = per-project assignment override ?? task default (no date ranges). Person rates ARE effective-dated. Confirm whether Harvest date-ranges task/project rates too. → rate phase.
- **[05] Money columns are 32-bit `Int` cents** (~$21M/row ceiling) — fine for invoices; revisit `BigInt` if any single stored amount could exceed that. → before production.
- **[Seed] `InvoiceAppearance` / `InvoiceLabels` not seeded** — models exist; add demo rows when the invoice renderer needs them. → invoice UI phase.
- **[UI] Multi-invoice client portal (client login) not captured** — needs a client account; single-invoice payment view is captured. → client-dashboard phase.
- **[07] Activity log** — Premium, disabled at Big Sea; not modeled in detail. → reporting phase (internal audit log via `AuditLog` still needed).
- **[Deploy] Deployment Protection** — production URL is currently public (fine for internal review). Before sharing anything client-facing, decide on Vercel Deployment Protection / password for preview URLs.
- **[Deploy] Ops/backup section missing from spec** — add Vercel+Supabase deploy steps and mandatory DB backups. → before first review deploy.
- **[UI] Pages currently `force-dynamic`** — fine now; revisit caching/streaming strategy per screen later.

## Resolved (spec bugs caught while building)

- **person-rate fallback order** — spec had person-default before per-project override; corrected so the override wins ([specs/03](specs/03-clients-projects-tasks.md)). Fixed 2026-08-04.
- **AC-TIME-004 rounding example** — `52 → 60` was wrong (52 is nearer 45); corrected to `53 → 60, 52 → 45` ([specs/04](specs/04-time-tracking.md)). Fixed 2026-08-04.

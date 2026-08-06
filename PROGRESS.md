# Build Progress

Running status of the Track2 build (time-tracking + invoicing app, modeled on Harvest). Updated as we go. Pairs with the specs in [`specs/`](specs/) and the build order in [README](README.md).

_Last updated: 2026-08-06._

## ▶ Resume here (next session)

**Track2 is a working, deployed, authenticated app.** Live at `big-sea-time-tracking.vercel.app` (alias `track2.bigseabridge.com`). Sign in with `dzuy@bigsea.co` (admin), or the demo users `alice@bigsea.demo` / `frank@bigsea.demo` / `zoe@globex.demo` (password `password123`). Everything is committed + pushed to `main`; working tree clean. **167 unit tests + `next build` green.**

**Done:** core loop (track → invoice → send → pay), every sidebar screen, auth + per-account tenancy, real migrations. **Full entity CRUD** (create + edit) for Client / Task / Project / Person. **Expense entry** + **expenses billed onto invoices**. **Inline time-entry edit**. **Public invoice** `/i/[token]`. **CSV export** + **Client detail**. **Global Harvest-style top bar** (Timer popover / Track-time modal / Create-invoice / More→Track-expenses, live running-timer pill). **Settings** (preferences + module toggles + categories + invoice appearance). **Invoice appearance theming** (brand/logo/columns, data-driven). **Retainers** (deposit/drawdown). **Recurring invoices** (profiles + generate-due + create-from-invoice). **Module nav/route gating** (AC-MOD).

**Every spec phase buildable without external input is now done (01–12).** What's left needs a decision or an artifact from you:
1. **Set `CRON_SECRET`** in Vercel project env → activates the daily recurring-invoice cron (`vercel.json` → `/api/cron/recurring`). Until then, the manual "Generate due" button covers it.
2. **Migration importer** (specs/13) — needs a real **Harvest CSV/API export** to build the column mapping against; risky to build speculatively.
3. **Online payment** on the public invoice — needs a **payment-provider** decision (Stripe, etc.).
4. **DB-backed tenant-isolation tests** (specs/08) — need a test-env `DATABASE_URL` loader (no `dotenv` dep yet). Isolation is verified live + covered structurally by the authz matrix.
5. **Audit log** (`AuditLog` model exists) — wire key mutations to write entries; broad-touch, deferred.
6. **Public estimate view** `/e/[token]` (mirror `/i/[token]`); reports CSV on the profitability/receivables tabs.

**Ops follow-ups (your call, dashboard settings):** provision a separate **production Supabase** (Pro, with backups) before real client data; optional Vercel preview-URL protection. See parking lot.

**Heads-up for whoever picks this up:**
- The `/i/[token]` public view uses a middleware-injected `x-pathname` header + a `bare` branch in [app/layout.tsx](app/layout.tsx) to drop the app chrome. New public routes: add the prefix to `PUBLIC_PREFIXES` in [middleware.ts](middleware.ts) **and** `BARE_PREFIXES` in the layout.
- Module gating: [lib/modules.ts](lib/modules.ts) `requireModule(accountId, key)` guards pages; [Sidebar](components/Sidebar.tsx) hides off-module nav. Defaults live in `DEFAULT_MODULES`.
- Invoice appearance/theming: [lib/appearance.ts](lib/appearance.ts) + shared [InvoiceLineItems](components/InvoiceLineItems.tsx) (column visibility). Both invoice views read it.
- Vitest now resolves the `@/` alias ([vitest.config.ts](vitest.config.ts)).

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
| 14 | Integrations (Asana / Stripe / Xero) | 🟡 | **Spec written** ([specs/14](specs/14-integrations.md)), grounded against Big Sea's live connected integrations: shared connection model, Stripe inbound payments, Xero outbound accounting sync, Asana import, + the Stripe→app→Xero money path. **Not built** — needs OAuth app credentials + a token secret-store decision |
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

# Build Progress

Running status of the Track2 build (time-tracking + invoicing app, modeled on Harvest). Updated as we go. Pairs with the specs in [`specs/`](specs/) and the build order in [README](README.md).

_Last updated: 2026-08-05._

## ▶ Resume here (next session)

**Track2 is a working, deployed, authenticated app.** Live at `big-sea-time-tracking.vercel.app` (alias `track2.bigseabridge.com`). Sign in with `dzuy@bigsea.co` (admin), or the demo users `alice@bigsea.demo` / `frank@bigsea.demo` / `zoe@globex.demo` (password `password123`). Everything is committed + pushed to `main`; working tree clean.

**Done:** core loop (track → invoice → send → pay), every sidebar screen, auth + per-account tenancy, real migrations, and entity **create** forms for Client / Task / Project (permission-gated).

**Next up (in order) — continue the CRUD block:**
1. ✅ **Invite Person** (Team) — create real logins (bcrypt, permission-gated, unique-email). _Edit-person still to do._
2. **Edit** forms — **Client edit ✅** (`/clients/[id]/edit`, currency locked once invoiced). Task edit + Project edit still to do.
3. **Expense entry** form (+ categories).
4. **Inline time-entry edit** on the timesheet.
5. Then: public invoice page `/i/[token]` (needs a small layout refactor), CSV exports, and a **UI-fidelity pass** (top bar, sidebar polish) toward the Harvest look.

**Ops follow-ups (your call, dashboard settings):** provision a separate **production Supabase** (Pro, with backups) before real client data; optional Vercel preview-URL protection. See parking lot.

## Current status

**Phase:** Feature build — entity CRUD. DB live on Supabase (migrations adopted); core logic tested; app deployed on Vercel with auth + multi-tenant scoping. Create forms landing for the core entities.

**Test suite:** 66 unit tests passing across 9 files; `next build` + `tsc` clean. Write paths (time, timer, invoicing lifecycle, CRUD creates) integration-verified against the DB.

## Build order checklist

Dependency order from the README. Status: ✅ done · 🟡 in progress · ⬜ not started.

| # | Area | Status | Notes |
|---|---|---|---|
| — | Spec set (findings + 00–13) | ✅ | Revised against live account |
| — | Prisma schema + seed | ✅ | `prisma validate` clean; seed type-checks |
| 01 | Data model | ✅ | Schema mirrors spec |
| 02 | Auth / permissions | 🟡 | **NextAuth v5** (credentials + JWT session carrying userId/accountId/profile) ✅, login page + middleware route protection ✅, **session-scoped tenancy across every page + action** (INV-5) ✅, `can()` capability layer ✅ + tests. Remaining: password reset, 2FA, invite/admin UI, capability enforcement in actions |
| 03 | Projects / **rate resolution** | 🟡 | `resolveRate` ✅ + tests; project/task/client CRUD services ⬜ |
| 04 | Time tracking | 🟡 | duration helpers ✅; time-entry logic (timer, one-running-timer, lock guards) ✅ + tests; **logTime + timer services** ✅ + DB integration-tested; **log-time form, start/stop timer UI, delete entry (lock-guarded)** ✅. Inline edit ⬜; timesheets/approval (module off) ⬜ |
| 05 | Invoicing | ✅ | **core loop complete & live**: generateInvoice (pool→draft), sendInvoice (number/lock/token/seq-bump), recordPayment (partial/full/overpayment-guard), markInvoiceDraft (unlock) — all DB integration-tested + wired to UI (generate control, send/mark-draft buttons, payment form). Remaining polish: delete-draft, public /i/[token] view, taxes/discount UI |
| 06 | Estimates | ⬜ | Module off at Big Sea — low priority |
| 07 | Reporting | 🟡 | **Time**, **Profitability** (revenue vs effective-dated cost → margin), **Receivables** (A/R aging) ✅ live, tabbed. CSV exports ⬜ |
| 08 | Non-functional | ⬜ | Tenant-isolation tests, authz, audit |
| 09 | Expenses | ⬜ | |
| 10 | Recurring / retainers | ⬜ | |
| 11 | Settings / modules | ⬜ | |
| 12 | UI (Next.js app) | 🟡 | App Router + Tailwind + Prisma singleton ✅; sidebar layout ✅; **every sidebar screen live + core loop + auth**. **Entity CRUD:** New **Client** ✅, New **Task** ✅, New **Project** ✅ (rich), **Invite Person** ✅ (bcrypt login, unique-email) — all permission-gated via `can()` in the action. Remaining CRUD: edit forms, expense entry, inline time edit; plus public /i/[token], CSV export |
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

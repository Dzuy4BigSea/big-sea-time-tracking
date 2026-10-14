# CLAUDE.md

**Track2** is Big Sea's time-tracking and invoicing app, modeled on Harvest. It is live at
https://track2.bigseabridge.com (Vercel project `big-sea-time-tracking`, Supabase Postgres) and
holds the full migrated Harvest history (~388k time entries, ~7.8k invoices).

## Read first
- [OPEN-ITEMS.md](OPEN-ITEMS.md): everything still open (settings, decisions, cutover, phase 2). Check items off as they're done.
- [PROGRESS.md](PROGRESS.md): current state, the "Resume here" section, and open work. Update it when you finish something.
- [specs/findings.md](specs/findings.md): ground truth from the live Harvest account. It overrides older spec text.
- `specs/NN-*.md`: one spec per domain, with Given/When/Then `AC-###` criteria. A behavior change starts as a spec edit.
- [MIGRATION-RUNBOOK.md](MIGRATION-RUNBOOK.md): the Harvest → Track2 import and delta-sync procedure.
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md): UI tokens and components.

## Stack and layout
Next.js 14 App Router, React 18, Tailwind, Prisma 5 (Postgres), NextAuth v5 (credentials + JWT), Vitest.
- `app/`: routes and server actions. `components/`: client and server UI. The app shell is `components/Shell.tsx`.
- `modules/<domain>/`: business logic (rate resolution, invoice state machine, totals, migration, integrations), with colocated `*.test.ts` files.
- `lib/`: cross-cutting helpers (`prisma.ts`, `session.ts`, `crypto.ts`, per-company resolution such as `appearance.ts` and `invoiceLabels.ts`).
- `prisma/schema.prisma` and `prisma/migrations/`. `prisma/sql/constraints.sql` holds raw constraints Prisma can't express.
- `scripts/`: offline migration and ops tooling (run with real `DATABASE_URL` / `INTEGRATION_ENC_KEY`; handle with care, they touch production data).

## Commands
```bash
npm test                 # unit tests (DB-free); must stay green
npx tsc --noEmit         # typecheck
npm run build            # next build
npm run test:integration # *.integration.test.ts against a live DB (needs .env)
npm run migrate:new      # print SQL diff for a new migration; save it under prisma/migrations/
```
There is no ESLint config, so `tsc` is the lint gate. Cloud sessions install deps through
`.claude/hooks/session-start.sh`. No `.env` is present in the cloud, so anything needing the DB
(integration tests, `next dev` pages, scripts) won't run there.

## Invariants (never violate; see specs/00-overview.md)
- INV-1: money is integer minor units, never floats (`modules/shared/money.ts`).
- INV-2: the billable rate is derived (`modules/projects/resolveRate.ts`), never typed in.
- INV-3: invoiced or approved entries are immutable. INV-4: no entry sits on two non-void invoices.
- INV-5: every query is scoped to the session's `accountId` (`lib/session.ts` → `requireUser()`).
- INV-6: invoice and estimate numbers are unique and never reused. INV-7: state transitions only go through the guarded state machine.
- Permission checks go through `can()` in `modules/shared/permissions.ts`, enforced in server actions.

## Performance rules
- Never `findMany` the full time-entry table. Lists and reports aggregate in the DB (`groupBy` / `$queryRaw`) with pagination.
- Add composite indexes as a migration when you add a new aggregation screen.

## Conventions
- Business rules live in `modules/`, not in Prisma or the React components; unit-test them there.
- Public views (`/i/[token]`, `/print/[id]`) drop the app chrome through `BARE_PREFIXES` in `app/layout.tsx`.
- Per-company (business entity) settings resolve entity → account → default.
- Secrets (`AUTH_SECRET`, `INTEGRATION_ENC_KEY`, `CRON_SECRET`, provider keys) live in Vercel env vars only. Never commit them.

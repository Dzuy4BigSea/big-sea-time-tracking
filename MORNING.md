# Morning summary — overnight autonomous run

_Everything below is committed + pushed to `main`; working tree clean. `next build` green, **167 unit tests** passing._

## What I built (each is its own commit, in order)

**First block — finishing the UI/CRUD I'd started:**
1. **Edit Person** — completes create+edit CRUD for Client / Task / Project / Person (permission-gated, self-lockout guard).
2. **Expense entry** — self-service expense form + admin category management.
3. **Inline time-entry edit** on the timesheet (duration + notes, lock-guarded).
4. **Public client-facing invoice** `/i/[token]` — no-auth, bare layout. Needed a middleware rewrite (injects `x-pathname`; layout drops the app chrome for `/i/*`). **Verified on the live Vercel edge**: public 200 + bare, protected 307→/login, bad token 404.
5. **CSV export** on Reports + **Client detail** page (`/clients/[id]`).

**Then you sent the Harvest top-bar screenshot** — I drove your live Harvest account to confirm exactly what each button does, then built faithful versions:
6. **Global top bar**: **Timer** (start-timer popover), **Track time** (new-entry modal), **Create invoice**, **⋯ More → Track expenses**, plus a live running-timer pill (ticking, with stop).

**Then you went to sleep and asked me to push through the remaining spec phases:**
7. **Settings** (spec 11) — preferences, **module toggles**, expense categories, **invoice appearance** editor.
8. **Expenses → invoicing** (spec 09) — uninvoiced billable expenses now flow onto generated invoices (with markup).
9. **Invoice appearance theming** (spec 05) — brand color / logo / column visibility are data-driven; both invoice views read it. Big Sea's setup (Description + Amount only) is seeded.
10. **Retainers** (spec 10) — deposit/drawdown math (+tests), uninvoiced aggregation, archive.
11. **Authz matrix tests** (spec 08) — full capability grid for all profiles (66 → 152 tests). Added a `@/` alias to the vitest config.
12. **Recurring invoices** (spec 10) — profiles, schedule math (+tests), generate-due, create-from-invoice, pause/delete.
13. **Module nav/route gating** (spec 11, AC-MOD) — off modules hide from the sidebar and their routes redirect home.
14. **Estimates** (spec 06) — full lifecycle + convert-to-invoice (separate number sequence; convert-once enforced). Module-gated (off at Big Sea, so hidden there).
15. **Recurring cron** — `/api/cron/recurring` + `vercel.json` daily schedule (real scheduled job).
16. **Home dashboard** — added a recurring + retainer summary card.

## Spec coverage
Phases **01–12 are done** (04 minus timesheet-approval, which is off at Big Sea; 08 has authz tests, DB-isolation tests deferred). Only **13 (migration importer)** is unstarted.

## 3 things that need YOU (all noted in PROGRESS.md → "Resume here")
1. **Add `CRON_SECRET`** to the Vercel project env to activate the recurring-invoice cron. Until then the manual **"Generate due"** button on `/recurring` does the same job.
2. **Migration importer (spec 13)** — I did *not* build this: it needs a real **Harvest CSV/API export** to map columns against, and a speculative importer could silently mismap data. Send me a sample export and I'll build + test it.
3. **Online invoice payment** — needs a payment-provider decision (e.g. Stripe) before I wire it; the public invoice is read-only for now.

## Notes
- All live-DB checks this session were read-only or rolled back — the seed data is unchanged (one live addition: an `InvoiceAppearance` row for the demo account, also in `seed.ts`).
- New architecture touchpoints are documented in PROGRESS.md under "Heads-up for whoever picks this up" (public-route/bare-layout, module gating, appearance, vitest alias).

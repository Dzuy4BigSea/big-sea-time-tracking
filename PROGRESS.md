# Build Progress

Running status of the Track2 build (time-tracking + invoicing app, modeled on Harvest). Updated as we go. Pairs with the specs in [`specs/`](specs/) and the build order in [README](README.md).

_Last updated: 2026-10-15._

## ▶ Resume here (next session)

**Everything still open is tracked in [OPEN-ITEMS.md](OPEN-ITEMS.md)** (Vercel settings, decisions, cutover, Chasity, phase 2).

### ⏱️ Track time from Asana tasks: Track2 Asana app (2026-10-19, branch `claude/todo-list-review-d6b1fe`, not deployed)
- Replaces Harvest's Asana integration with an official **Asana app** (App Components), following Harvest's flow:
  a **Track time** form on every Asana task (project + task, notes = the Asana task name, Duration blank = start a
  timer / filled = save an entry, total tracked to the task at the bottom; stop-only form while your timer runs on
  that task) and a **Track2 card** on the task showing hours tracked. Entries show "↗ Asana task" on the timesheet
  and detailed report. No browser extension; works in Asana web, desktop and mobile.
  Spec: [29](specs/29-asana-app.md). Setup: OPS.md §14.
- Time entries now keep the Asana link (`TimeEntry.externalService/externalId/externalGroupId/externalPermalink`,
  migration `20261019120000_time_entry_external_ref`). Form defaults use it: the last project/task used on that
  Asana task, else on that Asana project.
- `scripts/backfill-external-refs.mjs` restores Harvest's links on migrated entries from the stored snapshots;
  the importer and `rebuild-timesheets.mjs` now carry them.
- Code: endpoints `app/api/integrations/asana/app/*` (signed by Asana with the app secret), glue `lib/asanaApp.ts`,
  rules `modules/integrations/asanaApp/*` + `externalRef.ts`; page `/asana/t/[gid]` lists a task's time.
- Verified: unit tests (signature, form, widget, OAuth state, Harvest link mapping), tsc, `next build`. **Not yet
  run against Asana or the real DB**: needs the Asana app created, the migration run and the env vars (OPS §14).

### 🧩 Project tasks managed only on Edit project (2026-10-15, merged in PR #16, deployed)
- The project detail page no longer has "Manage tasks on this project"; adding/removing tasks, billable flags and task
  rates live only on **Edit project** → Tasks card (Harvest). Spec: [03](specs/03-clients-projects-tasks.md) AC-PROJ-015.
- "Add a task..." lists every active task (as on /tasks) not already on the project, alphabetically
  (`modules/projects/taskPicker.ts`: case-insensitive, numbered tasks in number order).
- Fixed: the Tasks card's `overflow-x-auto` clipped the picker's dropdown at the card's bottom edge, so the list
  never showed. Dropdown lists (`Combobox`) now keep a visible scrollbar inside the list (`.combo-scroll`).
- Verified: unit tests (4 new), tsc, `next build`, and the real Tasks card driven in Chromium with stubbed actions
  (54 tasks: sorted, not clipped, scrolls with a visible bar, pick adds the task). Not clicked through on a real DB.

### 🔗 Connect to Xero button (2026-10-15, merged in PR #15, deployed with the Xero env vars)
- Settings → Integrations → (company) → Xero now has **Connect to Xero** / **Reconnect to Xero**: an in-app OAuth2
  code flow (`app/api/integrations/xero/{connect,callback}`, rules in `modules/integrations/xeroOAuth.ts`, glue in
  `lib/xeroConnect.ts`). Spec: [14](specs/14-integrations.md) AC-XERO-014; setup in OPS.md "Xero sync".
- One Xero app for both companies; each company signs in on its own tab and gets its own refresh token.
- Needs Vercel `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` and redirect URI
  `https://track2.bigseabridge.com/api/integrations/xero/callback` on the Xero app. Optional `XERO_SCOPES`, `XERO_REDIRECT_URI`.
- Verified: unit tests, tsc, `next build`. Not yet clicked through against a real Xero org.

### 📝 Rich-text project notes (BugHerd #24, 2026-10-14, merged in PR #13)
- Notes is now an editable rich-text field on **New project** and **Edit project** (bold, italic, underline,
  bulleted/numbered lists, links), like Harvest's Notes field. Spec: [03](specs/03-clients-projects-tasks.md) AC-PROJ-012–014.
- Stored as sanitized HTML in the existing `Project.notes` column, so **no migration**. Plain-text notes from Harvest
  still display with their line breaks; `modules/projects/notes.ts` sanitizes on save and on display (allowlist, `sanitize-html`).
- Editor: TipTap (`components/RichTextEditor.tsx`), lazy-loaded so the Projects list doesn't ship it up front.
  New dependencies: `@tiptap/*` 2.27.1, `sanitize-html` 2.17.0.
- Verified: unit tests (8 new), tsc, `next build`, and the editor driven in Chromium on its own (no DB in the cloud,
  so the real Edit project page is not yet clicked through).
- **Caveat until cutover:** the Harvest delta sync overwrites every project field, notes included, so notes edited in
  Track2 revert to Harvest's text on the next import.

### 🔗 Billing chain: send → pay → Xero, triple-checked and traced (2026-10-14, draft PR, not deployed)
Four agents audited and hardened email, Stripe, Xero and visibility; everything merged on `claude/pensive-davinci-vmc0bo`.
- **Trace:** every step writes an `InvoiceEvent` (email accepted/delivered/bounced/spam/opened, client viewed,
  Stripe webhook received/recorded/failed/refunded/disputed, Xero invoice/payment synced or error). Shown as
  "Delivery & payment trail" on the invoice and on Settings → Activity log (filters, CSV, **Run checks now**).
  Provider retries are de-duplicated without logging errors. Daily integration health checks email admins.
- **Fixes:** all invoice-recipient contacts emailed; double-send/reminder guards; Stripe checkout idempotency,
  correct paidOn, ACH async; Xero exactly-once invoice/payment copy, token refresh under a lock, retries,
  cutover date, `syncPendingXero` retry path.
- **Verified on a seeded local Postgres:** 1064 unit, 31 integration (incl. the new `npm run test:chain`:
  the whole chain through the real webhook routes with SendGrid/Stripe/Xero faked, replays, forged posts,
  Xero outage + recovery), tsc, browser check of the trail and activity log.
- **To ship:** run the `InvoiceEvent` SQL script in Supabase, then merge; then the settings in OPEN-ITEMS §2b.

### 🌙 Unattended run 2026-10-13/14: Harvest screens 7–12, BugHerd round 2, MCP server (PR #7, **deployed 2026-10-14**)
All on branch `claude/pensive-davinci-vmc0bo` → draft PR #7. Verified on a seeded local Postgres (698 unit + 12 integration tests, tsc, build, browser/curl checks, live MCP calls). **Deployed 2026-10-14.** The seven pending migrations (incl. the PR #5 hot-path indexes) were applied in the Supabase SQL editor with RLS enabled on the new tables, and recorded in `_prisma_migrations`: `20261014090000_google_drive_grant`, `20261014120000_api_tokens`, `20261014120000_expense_list_indexes`, `20261014120000_manager_assignments`, `20261014120000_recurring_anchor_day`, `20261014180000_mcp_oauth`.
- **Specs:** [26 expenses](specs/26-expenses-parity.md), [27 recurring + statuses](specs/27-recurring-and-statuses-parity.md), [28 team](specs/28-team-parity.md), [22 MCP](specs/22-mcp-server.md). Built from Harvest's help center + read-only Harvest data (the web UI isn't reachable from the cloud). 26 details are marked **UNVERIFIED**; Chasity can settle them fastest by running capture items 7–12 ([spec 24](specs/24-harvest-ui-capture.md)) in a signed-in browser.
- **BugHerd round 2** ([spec 23](specs/23-bugherd-feedback.md)): #15, #25, #26 built; #4/#10 Drive export built (live once the Google OAuth client exists + Drive API/scope added, OPS.md §8). #15, #25, #26 moved to DONE (2026-10-14).
- **Behavior changes to know:** members now see only their own expenses (was account-wide: a leak); invoice Open tab counts drafts; recurring monthly 29th–31st no longer drift; managers with assigned people default to "My assigned people" on Team (Everyone one click away). Assigned people grant **no** extra access yet (phase 2, spec 28 §3.3).
- **MCP server:** personal access tokens at `/settings/tokens`; endpoint `/api/mcp` with 34 Harvest-named tools; Claude Code: `claude mcp add --transport http track2 https://track2.bigseabridge.com/api/mcp --header "Authorization: Bearer track2_pat_…"`. OAuth for claude.ai connectors built (below).

### MCP OAuth for claude.ai connectors (2026-10-14)
Built: OAuth 2.1 on the MCP server so claude.ai › Settings › Connectors › *Add custom connector* works with just
`https://track2.bigseabridge.com/api/mcp` (specs/22 §OAuth, OPS.md §9a). Discovery (RFC 9728/8414), dynamic client
registration, consent screen at `/oauth/authorize`, PKCE S256, rotating refresh tokens with reuse detection,
revocation, *Connected apps* on `/settings/tokens`. PATs keep working. **To ship:** `prisma migrate deploy`
(`20261014180000_mcp_oauth`), confirm `APP_URL`, then connect from claude.ai once. Not yet exercised end to end
against a database or real claude.ai (see the branch report).

### 🚦 Go-live hardening (2026-10-13)
A CTO-level audit (data safety, security, performance, invoicing) found go-live blockers. **All code fixes, Harvest-style fixed fee and Google sign-in are merged and live in production (PR #5, 2026-10-13)**; production check after deploy: new build serving from `iad1`, DB 70ms warm, signed-out pages redirect to /login, security headers present. Verified before merge: 510 unit tests (UTC and America/New_York), tsc, next build, invoicing integration tests on a throwaway Postgres, and a browser click-through (login, double-click Start, Stop, member nav) on a seeded local DB. Not yet run against production data.

**What changed (code)**
- **Data safety:** seed refuses unless `ALLOW_SEED=1` and the accounts look like demo data; destructive scripts need explicit `ACCOUNT_ID` and refuse prod-sized/Track2-owned data; the importer never overwrites entries/invoices that are locked, invoiced or edited in Track2; `MIGRATION_LOCKED=1` disables import/sync; streamed CSV exports + admin "Export everything" (`/settings/export`); `scripts/check-db-health.mjs` (`npm run db:health`) and `scripts/fix-number-sequences.mjs`; CI (`ci.yml`) and nightly encrypted `pg_dump` (`db-backup.yml`); restore procedure tested and written up in [OPS.md](OPS.md).
- **Security:** every invoice action needs `manage_invoices`; invoices/print/receivables/profitability gated; no self-promotion to Administrator; sessions re-check `isActive`/profile from the DB each request (deactivation is immediate); login lockout after 10 failures/15 min; PMs limited to projects they manage; rate overrides need `set_rates`; security headers; Stripe/email links from `APP_URL`.
- **Time:** "today" is the account timezone (US Eastern) everywhere, so evening work no longer lands on tomorrow; timer double-click is safe; timer errors are shown; 12h timer cap + auto-stop cron; warning for timers started on an earlier day; audit trail (before/after) on every time-entry change; faster timesheet and dashboard.
- **Invoicing:** no double-billing on concurrent generate; fixed-fee time no longer adds the full fee to every invoice; missing rates are re-derived or block generation (no silent $0); amount = rounded hours × rate (matches Xero/Harvest); Xero gets tax/discount lines; Stripe payments de-duplicated by PaymentIntent (ACH = bank transfer); paid invoices can't be deleted/reverted; re-send keeps its number; failed emails are shown; atomic number allocation that skips used numbers; recurring cron isolated per profile.
- **Speed:** hot-path indexes (migration `20261013200000_hotpath_indexes`), Projects paginated (archived 1.35s → 0.35s), retainers summed in SQL, per-request caching, loading skeletons + friendly error pages, `/api/health?deep=1`, GitHub keep-warm pinger, region pin `iad1`, 30s function timeout.
- **Login:** full page load after sign-in (a stale prefetch could bounce people back to /login); form POSTs so credentials never land in a URL.

**Go-live checklist (Dzuy; details in [OPS.md](OPS.md))**
1. Supabase: upgrade to **Pro** + PITR; confirm region is **us-east-1** (else change `regions` in vercel.json to match).
2. Vercel env (Production only): `DATABASE_URL` add `&connection_limit=5&pool_timeout=20`; `APP_URL=https://track2.bigseabridge.com`; `CRON_SECRET` (enables recurring invoices + timer auto-stop); `MIGRATION_LOCKED=1` **after** the final Harvest sync. Make sure `DATABASE_URL`/`AUTH_SECRET`/`INTEGRATION_ENC_KEY` are **not** shared with Preview; turn on Vercel Authentication for previews; turn on **Fluid Compute**; add a WAF rate-limit rule on `POST /api/auth/callback/credentials`.
3. GitHub secrets: `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `CRON_SECRET`; run "DB backup" once by hand.
4. Prod DB: `npm run db:health`; apply anything it reports missing (constraints, the hot-path index migration — CONCURRENTLY versions are in the migration header); delete demo users/the `acc_globex` account; rename the account from "Big Sea (demo)".
5. Invoice numbering: run `ACCOUNT_ID=acc_demo node --env-file=.env scripts/fix-number-sequences.mjs` and **decide** before `--confirm`: Harvest numbers like 387523 would make the next number ~389701. (Sends are already safe: allocation skips numbers in use.)
6. Final Harvest sync, then set `MIGRATION_LOCKED=1`. Recreate recurring profiles in Track2 and switch Harvest's off the same day. Keep Harvest read-only ~30 days as a fallback.
7. Click through on production: log time, timer, generate + send a test invoice to yourself, record a payment.

**Decided 2026-10-13 (Dzuy)**
- Sessions: 14-day sliding (was 12h). Access is still re-checked from the DB on every request.
- Invoice numbering continues Harvest's sequence: after the final Harvest sync, run `scripts/fix-number-sequences.mjs` (Harvest's latest was #392666, so Track2 starts at the next number).
- Members/PMs without billing capabilities don't see invoices or dollar amounts (approved).
- Fixed fee works like Harvest (done, [spec 05](specs/05-invoicing.md) AC-INV-003a–e): "New invoice" (`/invoices/generate`) lets you pick projects; a Fixed Fee project adds one editable line for the remaining fee (fee − amount on existing invoices, drafts included); its hours stay uninvoiced; drafts show "Show project context" (notes, fee, invoiced, remaining, related invoices); project/client/retainers/dashboard uninvoiced amounts use fee − invoiced. Integration-tested on a local Postgres.
- Google sign-in (done, off until configured; OPS.md §8): bigsea.co Workspace accounts only, matched to existing active users, password login kept as a fallback. Needs `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` from an Internal OAuth client.

**GitHub Actions parked (2026-10-13):** CI, nightly backup and keep-warm workflows are in `ops/workflows/` and don't run (see OPS.md §2). The timer auto-stop runs daily from the Vercel cron only.

**Waiting on Dzuy** (emailed 2026-10-13; reviewing costs 2026-10-14): Vercel plan (Hobby is non-commercial), keep-warm cadence vs UptimeRobot (and whether to re-enable the parked GitHub Actions), Sentry, go-live date + cutover order, keep or drop password login after Google works, Drive export format (CSV to a folder vs Google Sheet; whose Drive). Until cutover: don't send real invoices from Track2; the hot-path index migration is not yet applied on production (safe to apply any time, OPS.md).

**Not done:** Google Drive export (next, on top of Google sign-in), `onDelete: Restrict` on cascades, DB trigger for INV-3, `/reports` hours visible to all members, project-level rates/fees without `set_rates`, Xero TaxType mapping, the project page "Invoiced amount" card excludes drafts while fee − invoiced counts them.

### 🐞 BugHerd feedback + Harvest parity (updated 2026-10-12, end of day)
Goal: match Harvest's UI and behavior. Per-item status is in [specs/23](specs/23-bugherd-feedback.md); the Harvest reference and capture prompt are in [specs/24](specs/24-harvest-ui-capture.md).

**Where things stand**
- **Round 1 (15 of 21 BugHerd items): live in production.** It was merged in PR #1 on 2026-10-12. The `remainingOccurrences` column was added on prod by hand (Supabase SQL editor); the migration file uses `IF NOT EXISTS`, so `prisma migrate deploy` is still safe.
  - QA'd on prod with Claude in Chrome: all pass. Two are only partly checked because no data exists yet: recurring "N left / No end" labels, and the "due in N days" banner.
- **Harvest parity pass (PR #2): merged and live.**
- **Harvest UI layout pass, screens 1–6 (merged 2026-10-12, from the captured notes in [specs/24](specs/24-harvest-ui-capture.md)).** No schema changes. Smoke-tested against a local Postgres seeded with `prisma/seed.ts` (every changed page rendered, no server errors), but not yet against production data.
  - **Timesheet:** week pill ("This week 12 – 18 Oct 2026") with "Return to this week"; "Mon / 05 Oct" headers; rows read "[CODE] Project (Client)"; Day view (`?view=day&date=`) with Day/Week toggle, day tabs and totals; Teammates grouped Employees/Contractors with a "{Name}'s timesheet" banner; empty-state card.
  - **Clients:** card per client with its contacts, live "Filter by client or contact" (matches contacts too) with Clear filter, 100 per page; new pages `/clients/new`, `/clients/[id]/contacts/new` and `/clients/[id]/contacts/[contactId]/edit` (Update/Delete contact); archive/reactivate box on Edit client.
  - **Project page:** Harvest header (client, type pill, dates + weeks left, notes Show more); five all-time summary cards; toolbar "All time" / "[←][→] This Month: …"; Tasks (billable/non-billable sections) and Team tables expand to people/tasks; Invoices tab with Status/Issue date/Paid on/ID/Subject/Pre-tax amount and "+ New invoice". Monthly-reset budget card now measures the current calendar month.
  - **Edit project Team card:** Billable rate column only for person-rate T&M projects (switches live with the form), Person default / Custom / Missing rate cells, Apply custom rate, Manages-this-project checkboxes with Select All/None, archived people greyed, "Assign a person..." combobox, leave-page guard.
  - **Reports > Time:** Clients | Projects | Tasks | Teammates tabs (`?tab=`; old `?group=` still works), summary card with billable donut, billable-share bar, "1.30 (9%)" billable hours, Total row, Employees/Contractors subtotals, "Active projects only". **Uninvoiced amount now excludes Fixed Fee projects** (Harvest behavior), so the figure may drop.
  - **Not done from the notes:** AI boxes, copy-from-last-week, editable week-grid cells, Fax and CC/BCC contact fields (schema), project charts, Duplicate/Delete/Pin project actions, detailed time report (no route yet) so Hours aren't links, Scheduled/Delta/Utilization, cost-rate slide-over, Restore for archived people. Orange accents use Tailwind's `orange-*`; swap for brand tokens if wanted.

**Next steps, in order**
1. **Click through the layout pass on production** (Timesheet Day/Week + Teammates, Clients, a project page and its Edit page, Reports > Time) and check the Uninvoiced figure.
2. **Harvest UI notes:** screens 7–12 (expense reports, recurring invoices, invoice statuses, expenses form, team list, edit person tabs) still need capturing with the prompt in [specs/24](specs/24-harvest-ui-capture.md).
3. **Decisions (Dzuy):**
   - **Assigned people:** build Harvest's manager → people assignment (new table + "Assigned people" tab + timesheet/report scope)? Today managers act only on projects they manage.
   - **Project page default:** Harvest opens on All time; Track2 opens monthly-reset budgets on Month. Switch to Harvest's behavior?
   - **Client contacts:** add Fax (new column) and move contact add/edit onto the Clients list like Harvest?
4. **BugHerd items needing Chasity/Dzuy input:**
   - #4/#10 Google Drive export: is a CSV saved to a Drive folder enough, or should it create a Google Sheet? Whose Drive?
   - #5, #7, #15: need the BugHerd pin/screenshot to know which element.
   - #12: keep, move or remove the "By Category" expense report?
   - Card comments and status updates were posted on 2026-10-12 (record at the end of [specs/23](specs/23-bugherd-feedback.md)). FIXED cards are in DONE for Chasity to close; NEEDS INFO cards are assigned to her. New cards #22 and #23 (nice-to-haves) aren't triaged yet.
5. **Small data fixes on prod:**
   - Rename the account from "Big Sea (demo)" (left over from the seed; shows on invoices). There's no Settings field for it yet, so it's one SQL `UPDATE "Account" SET name = '…'`.
   - Cost-rate backfill: Profitability shows $0 cost ([spec 19](specs/19-migration-followups.md) item 4).
   - PM-flag breadth: ~90% of assignments are flagged PM (spec 19 item 1).
6. **Harvest → Track2 update sync:** still waiting to be run against prod (see the next section).
7. **Follow-ups:**
   - Stream the time CSV export ("All time" still `findMany`s every entry).
   - Use `DropdownMenu` (single-open menus) on the /projects, /clients and invoice row menus.
   - The Projects → Archived filter takes ~4s (2,227 rows); paginate it.

**Working from a cloud Claude session**
- The BugHerd API (`www.bugherd.com`, `BUGHERD_API_KEY`) is reachable from cloud sessions as of 2026-10-12. Python's default user agent gets a Cloudflare 403, so use curl or set a User-Agent. track2.bigseabridge.com and *.vercel.app may still be blocked; add them under Allowed domains to let Claude check pages itself.
- There's no prod DB access, so anything touching data (migrations, scripts, renames) is done by hand in Supabase or locally.

### ▶ Harvest → Track2 sync: where it stands (2026-10-14, end of day)
Everything now runs **without a local machine**: in-app steps on Settings → Migrate, scripts via GitHub →
Actions → **"Migration script (manual)"** → Run workflow (choose script; leave **apply** unticked = dry run).
Claude can trigger that workflow and read its logs from a cloud session.

**Done today**
- PRs merged: #9 billing chain + invoice trace, #10 "Discard unfinished backup" + manual migration workflow,
  #11 read-only `parity-check`, `HARVEST_TOKEN` fallback, **Incremental from a chosen date**.
- The 10/13 full backup that stalled was marked `error` (it hid the Incremental button).
- **Database password was reset.** Vercel `DATABASE_URL` = Supabase **Transaction pooler, IPv4/shared pooler**
  (`postgres.<ref>@aws-…pooler.supabase.com:6543`) + `?pgbouncer=true&connection_limit=5&pool_timeout=20`.
  The new password is in Dzuy's password manager. Do **not** use the "Direct"/"Dedicated pooler"
  (`db.<ref>.supabase.co`) string: it's IPv6-only and took the app down for a few minutes.
- GitHub secret `DATABASE_URL` = **Session pooler** string (port 5432). Verified: the dry run connected.
- Incremental **from 2026-08-06** (21,554 rows) → Preview (0 errors) → **Apply import** done: 4 clients, 20 projects
  (15 + 5 under the new clients), 1 person (Amber Stansfield), 91 new + 128 updated invoices. This pulls in the
  people/projects from the 9/30 and 10/07 deltas that were never imported (the importer only applies the newest snapshot).

**`rebuild-timesheets` dry run (before today's import), production**
- 2013–2025: Track2 matches Harvest exactly (entries and hours).
- 2026: Harvest 26,939 entries / 26,046.7 h vs Track2 21,367 / 20,526.1 h → +5,572 entries / +5,520.6 h to bring in.
- 468 entries were unmappable (19 projects + Amber missing) → fixed by the import above; re-check.
- **Go-live guard:** 1,121 entries sit on **one test draft invoice** (no number, created in Track2 2026-08-08,
  561.5 h, not from Harvest). Guard counts them as invoiced + edited, so `--apply` refuses.

**Next steps (in order)**
1. **Delete that test draft** in the app: Invoices → Drafts → the Aug 8 draft with no number (561.5 h) →
   Actions → Delete (releases the 1,121 entries). Not done yet as of this note.
2. Re-run the dry run (workflow: `rebuild-timesheets`, apply unticked). Expect: skipped ≈ 0, "on Track2 invoices" = 0.
   "edited in Track2" will still show ~1,121 (releasing the draft bumps their updatedAt).
3. Those are unkeyed bulk-import rows that the rebuild replaces with exact Harvest copies, so the write needs
   `--force-after-go-live`. **Dzuy must approve this explicitly**; adding the flag to the workflow was blocked by
   Claude's permission check pending that approval. Then run with apply.
4. Verify: Track2 home "Time summary" must equal Harvest for closed periods: **last month (Sept) 2,603.80 h**,
   **last week (Oct 5–11) 575.98 h** (Harvest reports, pulled 2026-10-14; weeks start Monday, America/New_York
   on both). "Today/this week/this month" lag Harvest until the next pull.
5. Add GitHub secret `HARVEST_TOKEN` (Harvest → Developers → personal access token), delete the bad
   `INTEGRATION_ENC_KEY` GitHub secret (it holds the literal text, not the key; the real key is a Vercel *Sensitive*
   var and can't be copied), then run `parity-check` (read-only, full Harvest ↔ Track2 report) and
   `sync-assignments` (dry run → apply).
6. Note: the 2026-10-14 pull had exactly 21,000 time entries; per_page is 2000 (10.5 pages), so not a cap, but
   confirm via step 4/parity-check.
7. Future syncs: Incremental → Preview → Apply in the app (time upserts by `harvestId` once step 3 has run).

### (history) Harvest → Track2 update sync (started 2026-09-29; code done 2026-10-07)
Catching up Harvest changes since the Aug 6–7 import. **All the code is built; what's left is running it against production** (needs the prod `DATABASE_URL`, so it can't be done from a cloud Claude session).
- **2026-09-30:** the in-app Incremental button is unlocked (it deltas from the last finished full backup; an estimates-only 403 counts as clean, [modules/migration/deltaSince.ts](modules/migration/deltaSince.ts)).
- **2026-10-07:** time entries are now keyed by `TimeEntry.harvestId` (unique per account; migration `20261007120000_time_entry_harvest_id` applied). [scripts/rebuild-timesheets.mjs](scripts/rebuild-timesheets.mjs) composes the full snapshot + every delta (newest `updated_at` wins), replaces each year with keyed rows in one transaction, never touches Track2-native entries, and writes the `time_harvest_ids` marker when done. After that, the importer's time stage upserts by `harvestId` instead of skipping.
- **State checked 2026-09-29:** Track2 hasn't been used for real work since the import (388,607 time entries; only native rows are 2 empty draft invoices). Replacing from Harvest won't clobber anything.
- **Run order (whoever has prod access):**
  1. Settings → Migrate → **Incremental (delta since last)**. Read-only on Harvest.
  2. **Preview import (dry run)**, review counts, then **Apply import**. Time is skipped this pass (not keyed yet); new people/projects/tasks land so step 3 can map to them.
  3. Locally: `node --env-file=.env scripts/rebuild-timesheets.mjs` (dry run: per-year reconciliation) → check the numbers → `--apply`. Needs only `DATABASE_URL` (reads snapshots from the DB). Resumable.
  4. `INTEGRATION_ENC_KEY=... node --env-file=.env scripts/sync-assignments.mjs` to refresh the roster (this one calls Harvest).
  5. Reconcile counts vs Harvest, then update the `migration-progress` notes.
  6. Future syncs: just steps 1–2; time now upserts by `harvestId`.
- **Known gap:** entries **deleted** in Harvest after the Aug snapshot are not removed (deltas only carry changed rows). Fix if it matters: pull the full id list for the affected years and delete keyed rows whose `harvestId` is missing (only safe for `harvestId` rows, never Track2-native ones).
- ⚠️ **Never re-import the Aug full snapshot via the button before step 3 has run.** Until entries are keyed, the importer would duplicate time (it now skips the time stage in that state, but don't rely on it).

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
- **Performance / scaling** ([spec 21](specs/21-performance-scaling.md)): warm-path is fixed (DB aggregation + indexes). Cold-start (slow first login after idle) needs infra — **Supabase Pro** (no auto-pause) + **Vercel Fluid Compute** + the `/api/health` keep-warm pinger. Same cold-start applies to API/MCP calls. Climb the ladder as usage grows.
- **MCP server / API** ([spec 22](specs/22-mcp-server.md)): build a token-authed API + MCP server so the team drives Track2 from Claude (pull reports, log time, create projects/invoices) like they do Harvest today. Read-only report pulls first, then write tools; reuse `modules/*` + `can()`.
- **Ops:** separate **production Supabase** (Pro + backups) before this is the system of record; set `CRON_SECRET` to activate recurring-invoice cron; decide Vercel deployment protection.
- ✅ **Detailed + saved reports (done 2026-10-13, [spec 25](specs/25-detailed-and-saved-reports.md)):** "+ New report" menu (Custom report / Detailed time / Detailed expense), `/reports/detailed` + `/reports/detailed/expenses` (builder, Show billable/invoiced, Group by, CSV), Saved reports tab (`SavedReport` table, migration applied to production 2026-10-13), Save / Edit / Update existing / Save as new / Duplicate / Archive / Delete, Time report Hours cells link to the detailed report. Verified on production except typing into the Save dialog (Claude's Chrome has 1Password, which blocks automation on that field). **Have someone save, edit, share and delete a real report once.** Not built: bulk Actions (mark invoiced / move hours), Excel/PDF/Drive export, Roles/Tags filters. Harvest's existing saved reports can't be migrated (no API endpoint), so people re-save theirs.
- ⚠️ **Track2 data stops at ~7 Aug 2026:** Aug has 477 entries and Sep 4 (vs ~3,000/month before), so recent weeks look empty in every report. The Harvest update sync (see "In progress" above) still needs to run.
- ✅ **Reports default timeframe (done 2026-10-13, Harvest parity):** Time, Expenses and Profitability now open on **Week** anchored on today ("This week 12 – 18 Oct 2026"), not All time or the latest tracked week. Week start follows the account preference (`accountWeekStartsOn`); Big Sea's account is set to **Monday** (checked in the DB). Known edge: "today" is the UTC date, so from 8pm Eastern on Sunday the default jumps to the next week (Harvest uses the account time zone).
- **Failing tests (noted 2026-10-13): 5 in [modules/invoicing/statusBanner.test.ts](modules/invoicing/statusBanner.test.ts)** (`deriveStatusBanner`: sent not yet due, past due, partially paid, sent with no due date, paid). Every failure is a date one day early (expected `07/30/2026`, got `07/29/2026`). Cause: `formatDate` in [lib/format.ts](lib/format.ts) formats in the machine's local time zone, but dates are stored as UTC midnight. They pass where TZ=UTC (Vercel, cloud sessions) and fail on a US-time-zone machine (Dzuy's Windows box). Production pages render on Vercel (UTC), so live dates are correct today, but any `formatDate` that runs in the browser would show the previous day. Likely fix: add `timeZone: 'UTC'` to `formatDate` (and check the other `Intl.DateTimeFormat` calls), then rerun the suite in a non-UTC TZ.
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

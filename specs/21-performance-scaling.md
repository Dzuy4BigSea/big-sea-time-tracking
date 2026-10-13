# 21 — Performance & scaling (deployment)

Where Track2 is fast today, what makes it slow, and the ladder of changes to climb **as usage grows**.
None of the infra items below are needed for the current internal pilot; they're the plan for "if we
start using it more." Pairs with the **Performance** section of [17-ui-functional-audit.md](17-ui-functional-audit.md).

## Two different "slow"s
Don't conflate these — they have different fixes.

1. **Warm-path query cost** — how long a request takes once everything is awake. This was the real
   problem at full data volume (388k time entries): several screens loaded raw rows and reduced in JS.
   **Fixed (2026-08-08):** every list/report/dashboard aggregates in the DB (`groupBy` / `$queryRaw`),
   plus composite indexes (`TimeEntry(accountId,spentDate)`, `(projectId,spentDate)`;
   `Invoice(accountId,issueDate)`, `(accountId,status)`). Measured: Team week-nav 570ms→117ms,
   dashboard multi-second→~900ms, reports sub-second. This is code, already deployed.

2. **Cold start** — the *first* request after the app/DB has been idle. Two stacked causes:
   - **Serverless function cold boot** (Vercel): fresh Node lambda + bundle + Prisma engine init
     (~0.3–2s).
   - **Database connection / wake**: opening a fresh pooled Postgres connection, and — the big one —
     **Supabase free-tier auto-pausing the DB when idle**, which takes ~5–30s to wake. This is the
     likely dominant cause of the reported 5–25s logins.
   Cold start is **infra**, not code. The code mitigations we shipped: `authorize()` no longer reports a
   cold-connection blip as "invalid password"; `/api/health` (cheap `SELECT 1`) for keep-warm.

## Round 2 (2026-10-13): what shipped, and how it was measured
Measured on a local Postgres 16 with production-like volume (300k time entries, 2k projects with 65%
archived, 30k assignments, 7.8k invoices) behind a proxy adding 10ms round-trip per DB packet (a
same-region Vercel→Supabase hop is ~1–2ms; a cross-region one is 30–80ms, which multiplies everything
below). Median of 5 warm requests:

| Page | Before (`connection_limit=1`) | After, `connection_limit=1` | After, `connection_limit=5` |
|---|---|---|---|
| `/projects?status=archived` | 1.35s, 5.9MB HTML | 0.50s, 0.63MB | 0.35s |
| `/projects` | 1.03s, 3.3MB | 0.53s, 0.64MB | 0.27s |
| `/timesheet` | 0.58s | 0.37s | 0.25s |
| `/retainers` | 1.12s | 0.47s | 0.23s |

- **Projects list** is paginated (100/page, stable order), the manager dropdown is one `SELECT DISTINCT`,
  and spend/expense aggregates cover only the page's project ids. The archived list's cost was mostly
  rendering ~1.3k rows (a 5.9MB response), not the queries.
- **Retainers** sum the uninvoiced pool per project in SQL instead of loading every uninvoiced billable
  entry. The SQL repeats the old JS rounding exactly (float `FLOOR(x + 0.5)`; verified to the cent on
  25k entries).
- **Per-request dedupe:** `loggableProjectsFor` / `listActablePeople` / `managedProjectIdsFor` use React
  `cache()`, so the layout's top bar and the timesheet share one query set (22 → 17 statements).
- **Indexes** (migration `20261013200000_hotpath_indexes`, `IF NOT EXISTS`):
  `ProjectUserAssignment(userId, isActive)` (every page's top bar; was a sequential scan: 5.6ms → 2.1ms
  at 30k rows) and the partial `TimeEntry_uninvoiced_billable_idx` on `(accountId, projectId) INCLUDE
  (minutes, billableRateCents, isRunning, lockState) WHERE isBillable AND invoiceLineItemId IS NULL`
  (uninvoiced-pool sums become index-only scans: 52ms → 25ms, no heap reads). Already covered and
  verified: `TimeEntry(userId, spentDate)`, the running-timer partial unique index, `Invoice(clientId)`.
- **`connection_limit`:** with `1`, each request's `Promise.all` runs one query at a time. Recommended
  `DATABASE_URL` params: `pgbouncer=true&connection_limit=5&pool_timeout=20` (see `lib/prisma.ts`).
- **Cold start:** `lib/prisma.ts` keeps one client on `globalThis` in every environment (reused across
  invocations under Fluid Compute). `/api/health` runs on Node, reports `dbMs`, `cold` (first request
  on this instance) and `region`, and `?deep=1` also does an index-only read of the busiest TimeEntry index
  with a 5s timeout. `.github/workflows/keep-warm.yml` pings `/api/health?deep=1` and `/login` every 5
  minutes in working hours (weekdays 11:00–02:00 UTC) and hourly otherwise. In a private repo that is
  ~4k Actions minutes/month (each run bills as 1 minute): drop to every 10 minutes, or use a free
  external monitor (UptimeRobot, 5-minute checks) on the same URL if minutes matter.
- **Region:** pin functions next to the database (`"regions": ["iad1"]` in `vercel.json` when the
  Supabase project is in `us-east-1`: Supabase dashboard → Project Settings → General → Region, or the
  pooler host `aws-0-<region>.pooler.supabase.com`). A mismatched region multiplies every round trip
  in the table above.
- **Bundles:** client First Load JS is 87kB shared and ≤116kB per route; the largest server chunk is
  ~310kB. Nothing heavy is imported by the root layout or the shell, so bundle size is not a material
  cold-start cost. The Prisma library engine (5.22, `binaryTargets = native + rhel-openssl-3.0.x`) is
  the default and correct for Vercel; engine init measured ~0.1s.
- **Loading and error states:** `loading.tsx` skeletons (projects, project detail, reports, invoices,
  clients, team, timesheet) show instantly on navigation; `app/error.tsx` / `app/global-error.tsx` show a
  "Try again" screen (with the error digest) instead of a blank failure when the DB is slow to wake.

## Does this apply to API calls / the MCP server / webhooks too?
**Yes — identically, and it matters more there.** Every serverless entry point that touches the DB —
page render, server action, REST/API route, the [MCP server](22-mcp-server.md), Stripe webhooks, cron —
pays the same function cold boot + DB connection/wake. Extra considerations specific to programmatic
traffic:
- **Timeouts:** machine callers (Claude via MCP, webhook senders) often have short timeouts; a 25s cold
  DB wake can fail the call outright, not just feel slow.
- **Connection pool math:** each warm serverless instance holds `connection_limit=1` to the transaction
  pooler. Bursty API/MCP traffic spins up many instances → many pooler connections → you can hit the
  pool ceiling. A managed pool (Prisma Accelerate / PgBouncer tuning / RDS-Proxy-style) matters as
  concurrency rises.
- **Idempotency & retries:** callers retry on timeout; write endpoints must be idempotent (webhooks
  already are; MCP write tools should be too).

## The scaling ladder (cheapest first) — do these as usage grows
1. **Supabase Pro (~$25/mo)** — DB stops auto-pausing. Highest-leverage, lowest-effort; most likely
   removes the bulk of the cold-login pain. **Do this first when it starts to bite.**
2. **Vercel Fluid Compute** — keeps function instances warm / reuses them; far fewer cold boots. A
   dashboard toggle.
3. **`/api/health` keep-warm ping** — free external monitor (UptimeRobot etc.) every ~5 min. Already
   built; belt-and-suspenders.
4. **Managed connection pooling** — Prisma Accelerate (managed pool + optional query caching) or tuned
   PgBouncer, once API/MCP concurrency grows enough to pressure the pool.
5. **Selective caching** — `revalidate` / `unstable_cache` on aggregates that rarely change (prior-month
   / prior-year report totals never change); big win for repeat views.
6. **Only if 1–5 aren't enough → always-on host.** Run the app as a long-lived container (Render /
   Railway / Fly.io / ECS-Fargate, min instances ≥ 1) instead of scale-to-zero functions. Eliminates
   *both* cold starts and keeps a persistent warm Prisma pool — the cleanest cure for the connection
   half — at the cost of paying for idle + more ops. For an internal tool of ~24 users this is usually
   overkill; revisit if it becomes the system of record with external/API load.

## When to pull each lever (triggers)
- Logins/first-loads regularly slow, or the app is used sparsely (long idle gaps) → **#1 + #3** now.
- Steady daily use, still occasional cold boots → **#2**.
- MCP server or public API in real use, or webhook timeouts appearing → **#4** (+ #2).
- p95 latency SLA, or heavy background jobs / always-on API → evaluate **#6**.

## Verify before spending
Couldn't reproduce the cold 5–25s from a warm dev connection — the "Supabase Pro is the 80%" call is a
strong inference from the symptom shape, not a measurement. Cheap confirmation: check whether the slow
logins correlate with the app having been idle a while (that fingerprint ≈ DB auto-pause). If Pro +
Fluid Compute don't fix it, that points at option #6.

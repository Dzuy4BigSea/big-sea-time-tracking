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

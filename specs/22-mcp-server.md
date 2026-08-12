# 22 — Track2 MCP server (drive Track2 from Claude)

## Why
The team already uses Claude with a **Harvest MCP** to pull reports, log time, create projects, list
invoices, etc. To fully replace Harvest, Track2 needs its own **MCP server** exposing the same surface,
so people keep that workflow ("Claude, log 2h to the Acme project", "pull this month's utilization",
"create a project for client X") against Track2 instead.

This is also, in effect, Track2's **public API** — the MCP tools are thin wrappers over an
authenticated API layer, which is independently useful (scripts, Zapier, future integrations).

## Architecture (two layers)
1. **Authenticated API layer** (build first). A token-authed REST/RPC surface over the existing service
   modules (`modules/*`) — *not* raw DB access. Every endpoint reuses the current guards:
   `requireUser`-equivalent (token → user + account), account scoping (INV-5), and the `can()`
   capability layer. Read endpoints and write endpoints map to the same actions the UI calls, so
   business rules (rate resolution, invoice state machine, lock guards, multi-entity routing) are
   enforced once.
2. **MCP server** — a small [`@modelcontextprotocol/sdk`] server that maps MCP tools → API calls. Can be
   hosted as a **remote MCP** (HTTP/SSE) so users add one URL in Claude, authenticating with their
   personal Track2 token. (A stdio build is possible too but remote is the team-friendly path.)

Keep the MCP server stateless; all state + authz live behind the API.

## Auth model
- **Per-user API tokens** minted in Settings (like the integrations credential UI): `track2_pat_…`,
  hashed at rest, revocable, last-used shown. A token acts *as that user* — inherits their permission
  profile + overrides, so a member can't pull account-wide financials the UI wouldn't show them.
- Account scoping is automatic (token → accountId). Multi-entity (BS/CL) routing follows the same
  resolution as the app.
- Rate-limit per token; log tool calls to `AuditLog` (actor = token's user) for traceability.

## Tool surface (mirror the Harvest MCP the team uses)
**Read**
- `list_clients` / `get_client`, `list_projects` / `get_project` / `get_project_budget`,
  `list_tasks`, `list_users`, `list_project_assignments`, `list_expense_categories`
- `list_time_entries` (filters: user/project/date range), `get_running_timer`
- `get_time_report` (group by client/project/task/teammate; period) — wraps the same aggregation as
  `/reports`; also `get_profitability`, `get_receivables`, `get_uninvoiced`
- `list_invoices` / `get_invoice`, `list_expenses`
- `get_account_settings`

**Write** (permission-gated, idempotent where possible)
- `log_time`, `start_timer`, `stop_timer`, `update_time_entry`, `delete_time_entry`
- `create_client` / `update_client`, `create_project` / `update_project`, `create_task` /
  `update_task`, `add_task_to_project`, `assign_user_to_project`, `create_person` (invite)
- `create_expense` / `update_expense`
- `create_invoice`, `create_invoice_from_tracked_time`, `send_invoice`, `record_payment`
- (Guard destructive/outbound tools — send/delete — behind the caller's `can()`; consider a
  confirmation convention so Claude surfaces side-effectful writes before doing them.)

## Non-functional
- **Reuse the service layer** — no business logic in the MCP/API tier; it calls `modules/*` so the
  invoice state machine, rate rules, lock guards, and entity routing stay authoritative and tested.
- **Structured errors** — return typed errors (not found / forbidden / validation) so Claude can act on
  them.
- **Cold-start / pooling** — the API is serverless and hits the same DB, so it inherits the cold-start
  and connection-pool concerns in [21-performance-scaling.md](21-performance-scaling.md); machine
  callers are timeout-sensitive, so revisit warm-functions + managed pooling before heavy MCP use.
- **Versioning** — namespace the API (`/api/v1/…`) so tool contracts are stable.

## Build order
1. **Token model + minting UI** (Settings) + `requireToken()` middleware (token → user/account/caps).
2. **Read API v1** over the service/aggregation layer (clients/projects/tasks/users/time/reports/
   invoices/expenses) — highest value, lowest risk; unblocks "pull reports from Claude".
3. **MCP server** wrapping the read API; ship read-only first (report pulls + lookups).
4. **Write API + tools** (log_time, create_project, create_invoice, …) with permission gating + audit.
5. **Docs** — a short "connect Claude to Track2" guide (add the MCP URL, paste your token).

## Deferred / decisions
- Remote MCP hosting location (same Vercel app as an MCP route vs a separate small service).
- OAuth device flow instead of PATs (nicer UX; more to build) — start with PATs.
- Whether to expose account-wide reporting tools to non-admins (default: scope to the caller's `can()`).

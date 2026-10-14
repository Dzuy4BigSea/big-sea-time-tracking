# 22 — Track2 MCP server (drive Track2 from Claude)

## Status (2026-10-14)
**v1 built:** personal access tokens + a remote MCP endpoint at `/api/mcp` exposing 34 tools that mirror the
Harvest MCP the team already uses (names, parameters, descriptions' guidance, response shapes). Drafts-only
invoicing; no send / payment / delete tools yet. Needs `prisma migrate deploy`
(`20261014120000_api_tokens`) before use.
**OAuth 2.1 built (2026-10-14):** claude.ai custom connectors connect with just the URL (see §OAuth). Needs
`prisma migrate deploy` (`20261014180000_mcp_oauth`).

## Why
The team already uses Claude with a **Harvest MCP** to pull reports, log time, create projects, list
invoices, etc. To fully replace Harvest, Track2 needs its own **MCP server** exposing the same surface,
so people keep that workflow ("Claude, log 2h to the Acme project", "pull this month's utilization",
"create a project for client X") against Track2 instead.

## Architecture (as built)
- **Auth layer** — `lib/apiAuth.ts` `authenticateBearer()`: `Authorization: Bearer track2_pat_…` → SHA-256 →
  `ApiToken` row (not revoked) → `lib/session.ts` `currentUserForToken()`, which re-reads `isActive`, account,
  permission profile and overrides from the DB on every request and returns the same `CurrentUser` a browser
  session gets. Every existing guard therefore applies unchanged: `can()`, PM scope (`lib/timesheetSubject.ts`
  `mayActForOnProject` / `managedProjectIdsFor`), lock guards, account scoping (INV-5).
- **Protocol layer** — `modules/mcp/jsonrpc.ts` (pure, unit-tested): JSON-RPC 2.0 over Streamable HTTP,
  **stateless**: `initialize` (negotiates 2025-06-18 / 2025-03-26 / 2024-11-05), `ping`, `tools/list`,
  `tools/call`, notifications (→ HTTP 202), batches. No sessions, no SSE (`GET` → 405). Implemented directly
  instead of `@modelcontextprotocol/sdk` (no new dependency; fits a Next route handler with no transport glue).
- **Tool layer** — `lib/mcp/tools/*.ts`, thin adapters over `modules/*`: input schema (a JSON-Schema subset,
  `modules/mcp/schema.ts`, published in `tools/list` and enforced on call), permission check, call the domain
  service, shape the Harvest-style response. Business rules stay in `modules/` — new services added for the
  API: `modules/time/editEntry.ts` (edit/move/delete with INV-3 guards + audit), `modules/projects/projectSetup.ts`
  (create project, assign/unassign, add/remove task), and optional time/expense windows on
  `modules/invoicing/generateInvoice.ts`.
- **Route** — `app/api/mcp/route.ts`: auth (401 + `WWW-Authenticate: Bearer …`), per-token rate limit
  (120 req/min/instance → 429), JSON parse (400), dispatch, one `AuditLog` row per write call
  (`entityType: api_token`, `entityId`: token id, actor: the user, `after.tool/args/resultId`), 503 + `Retry-After`
  when the DB is unreachable. The NextAuth middleware matcher skips `/api/*`, so `/api/mcp` is never redirected
  to `/login` (verified with `next start`: 401 JSON, not 307).

## Auth model
- **Personal access tokens** at **Settings › Personal access tokens** (`/settings/tokens`, linked from the sidebar
  user block as *API tokens*). Any active user manages their own: create (name; plaintext `track2_pat_<43 chars>`
  shown once), list (name, `track2_pat_<prefix>…`, created, last used), revoke. Max 10 active per person.
- Stored: `ApiToken(id, accountId, userId, name, tokenHash (sha256 hex, unique), prefix (first 8 chars of the
  secret), lastUsedAt (refreshed at most every 5 min), createdAt, revokedAt)`.
- A token acts *as that user*: a Member can't read others' time, a PM sees only their managed projects, money
  fields follow `view_billable_rates`, invoices need `manage_invoices` — exactly as in the UI.
- Revoking, deactivating the person, or changing their access takes effect on the next request.

## How to connect
URL: `https://track2.bigseabridge.com/api/mcp` · header `Authorization: Bearer track2_pat_…`
1. Create a token at Track2 › your name (sidebar) › **API tokens**. Copy it (shown once).
2. **Claude Code:**
   `claude mcp add --transport http track2 https://track2.bigseabridge.com/api/mcp --header "Authorization: Bearer track2_pat_…"`
3. **Claude Desktop** (config `mcpServers`), via the `mcp-remote` bridge, which forwards headers:
   ```json
   { "track2": { "command": "npx", "args": ["-y", "mcp-remote", "https://track2.bigseabridge.com/api/mcp",
     "--header", "Authorization:${AUTH_HEADER}"], "env": { "AUTH_HEADER": "Bearer track2_pat_…" } } }
   ```
4. **claude.ai › Settings › Connectors › Add custom connector:** enter `https://track2.bigseabridge.com/api/mcp`
   (no token, leave the OAuth client id/secret fields empty) → **Add** → **Connect**. claude.ai opens a Track2
   window: sign in if asked, then **Allow** on the consent screen. See §OAuth. (Tokens in URLs are not supported.)

## OAuth (claude.ai custom connectors)
Implements the MCP Authorization spec (2025-03-26 / 2025-06-18). Track2 is both the resource server
(`/api/mcp`) and the authorization server (issuer = the app origin from `APP_URL`, lib/appUrl.ts).

**Endpoints**
| What | Where |
|---|---|
| Protected Resource Metadata (RFC 9728) | `GET /.well-known/oauth-protected-resource` (also `…/api/mcp`): `resource` = `<APP_URL>/api/mcp`, `authorization_servers` = [`<APP_URL>`], `bearer_methods_supported` = [`header`] |
| Authorization Server Metadata (RFC 8414) | `GET /.well-known/oauth-authorization-server`: code only, `authorization_code` + `refresh_token`, PKCE `S256` only, client auth `none` / `client_secret_post` / `client_secret_basic` |
| Dynamic Client Registration (RFC 7591) | `POST /api/oauth/register` (open, 20/hour/IP per instance) |
| Authorization + consent | `GET /oauth/authorize` (page) → `POST /oauth/authorize/decision` |
| Token | `POST /api/oauth/token` (form-encoded; 60/min/IP per instance) |
| Revocation (RFC 7009) | `POST /api/oauth/revoke` |

`/api/mcp` answers 401 with `WWW-Authenticate: Bearer realm="Track2", resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"`
(+ `error="invalid_token"` when a token was sent). It accepts **both** `track2_pat_…` (PATs) and `track2_oat_…`
(OAuth access tokens). Discovery, token, register, revoke and `/api/mcp` send CORS `Access-Control-Allow-Origin: *`
without credentials (no cookies are involved).

**Flow (what users see)**
1. claude.ai registers itself (client name "Claude", redirect `https://claude.ai/api/mcp/auth_callback`).
2. It opens `/oauth/authorize?...`. Signed out → `/login?callbackUrl=<that URL>`; after password or Google sign-in
   the login page returns there (same-origin paths only, `modules/shared/safeRedirect.ts`).
3. Consent screen (bare, no app chrome): "**{client name} wants to access Track2 as {your name}**: read and log
   time, work with projects, clients, expenses and draft invoices, with your permissions", plus the signed-in
   email and the host it will return to. **Allow** / **Deny**.
4. Allow → one-time code → back to claude.ai → token exchange → Claude lists Track2's tools. Deny →
   `error=access_denied`.

**Rules (modules/oauth/, unit-tested)**
- Redirect URIs: `https://` only, or `http://` on `localhost` / `127.0.0.1` / `[::1]`; no fragment/userinfo/custom
  schemes; max 10. At authorize time, exact string match (loopback may change only its port, RFC 8252).
  Unknown client or unregistered redirect URI → error page, never a redirect (no open redirect). Other errors go
  back with `error=` and the `state` echoed.
- PKCE mandatory, `S256` only; `resource` (RFC 8707) must be `<APP_URL>/api/mcp` (absent → defaults to it).
- Authorization code: `track2_oac_…`, 10 minutes, stored as SHA-256, bound to client, redirect URI, user/account,
  code challenge and resource. Consumed atomically before any other check (a failed exchange burns it); a replayed
  code revokes the grant it produced.
- Access token `track2_oat_…` (1 hour), refresh token `track2_ort_…` (30 days, rotating), both SHA-256 only.
  Presenting an already-rotated refresh token revokes the whole grant (reuse detection). Revocation of either
  token revokes the grant.
- Consent POST: same-origin only (`Origin` must equal `APP_URL`, else `Sec-Fetch-Site: same-origin`) and the
  session is re-read; every parameter is re-validated. Clickjacking: global `frame-ancestors 'none'`.
- Secrets are compared in constant time; codes/tokens/verifiers are never logged (errors log only the error name).

**Data** (`20261014180000_mcp_oauth`, additive + idempotent): `OAuthClient` (global; self-registered clients grant
nothing alone), `OAuthAuthorizationCode`, `OAuthGrant` (one user's consent to one client = a "connected app"; the
token family; account-scoped), `OAuthToken` (`kind` access/refresh, `expiresAt`, `rotatedAt`, `revokedAt`).
Separate tables rather than widening `ApiToken`: PATs have no expiry/rotation/client, and the grant is the unit
users revoke.

**Same user, same permissions:** an access token resolves through `currentUserForToken()` exactly like a PAT
(fresh `isActive` / account / profile / overrides on every request; deactivation cuts access at once). Rate limit
key is the grant; write calls are audited with `entityType: oauth_grant`, `entityId` = the grant id. Consent writes
an `oauth_client` audit row; disconnecting writes an `oauth_grant` row.

**Revoking:** Track2 › your name › *API tokens* (`/settings/tokens`) › **Connected apps** › Revoke (grant + all its
tokens, immediate). Removing the connector in claude.ai calls the revocation endpoint if the client does so.

## Tool mapping (Harvest MCP → Track2)
Same tool names and parameter names throughout. Common differences: **ids are strings** (numeric ids are
accepted and stringified); hours are decimal but **stored as whole minutes** (min 1 minute, so a value that rounds
to 0 minutes is rejected, not 0.01 h); Track2 stores durations only, so `started_time`/`ended_time` are derived into
minutes and come back `null` (like a Harvest decimal-hours account); unknown parameters are rejected
(`validation_failed`) rather than ignored; "today" is the account timezone (`lib/tz.ts`). Errors are tool errors
(`isError: true`) with `{ error: { code, message, details? } }`, `code` ∈ `not_found | forbidden |
validation_failed | conflict | rate_limited | internal_error`. Pagination: `limit` / `cursor` / `next_cursor` /
`truncated` (+ `total_count` on lookup lists); cursors are opaque and bound to the filters they were issued for.

| Harvest tool | Track2 tool | Differences |
|---|---|---|
| get_account_settings | get_account_settings | Same fields. `approval_required` = timesheet-approval module; `time_rounding.style` is always `nearest`. Extras: `timezone`, `today`, `base_currency`, `account_name`. |
| list_clients | list_clients | Same. Extras: `address`, `cursor`/`next_cursor`. |
| list_projects | list_projects | Same filters. Every user sees all projects (as in the Track2 UI). Extras: `project_type`, `bill_by`, `billable_rate`/`fee` (rate-gated), `project_code`, `limit`/`cursor`. |
| list_tasks | list_tasks | Same (default active only). `updated_at` not tracked. `default_hourly_rate` is rate-gated. |
| list_users | list_users | Same filters, ordered by id. `email`/capacity/timezone only for yourself unless you can manage people. `access_role` = Track2 profile label. |
| list_project_assignments | list_project_assignments | Same rosters. `billable_rate_source`: `project_override` / `person_default`. Per-person `budget` is always null (Track2 stores one project-wide hours budget). |
| get_project_budget | get_project_budget | `budget_by`: none / project / task / person / project_cost, plus `cost` (internal cost budget; usage not computed). Extras: `budget_remaining`; for fixed-fee projects `fee`, `fee_invoiced`, `fee_remaining`. |
| list_time_entries | list_time_entries | Same filters/semantics incl. `user_id(s)`, `project_id(s)`, `is_invoiced`, `scope_limited`, keyset cursor. `is_invoiced` is true for entries on a draft too (they're reserved). `approval_status` is `approved` or `unsubmitted` (Track2 locks per entry). Extras: `invoice_id`, `is_locked`, client and project code. |
| get_running_timer | get_running_timer | Same incl. `scope_limited`. |
| get_time_report | get_time_report | Same rows/totals/hours fields and `include_zero_hour_users`. Extra `group_by: task`; `billable_amount` when rates are visible; `scope_limited` (true unless account-wide). Same SQL aggregation as Reports › Time. |
| list_invoices | list_invoices | Same filters minus `approved` (no invoice approval in Track2); plus `written_off`, `closed`. Drafts have `number: null` (Track2 numbers on send, INV-6). `retainer_id` / `recurring_invoice_id` always null (not linked in the schema). Requires `manage_invoices`. |
| get_invoice | get_invoice | Same header + `line_items`. Extras: `line_type` (time/expense/free_form/flat), `time_entry_count`, `expense_count`, `paid_amount`, `payment_term`. `taxed2` mirrors `taxed` (one taxable flag). |
| list_expenses | list_expenses | Same incl. `is_invoiced` / `is_billed`. Extras: `markup_percent`, `billable_amount`, `client_*`, `scope_limited`. |
| get_expense | get_expense | Same. `has_receipt` reflects the receipt link; extras `receipt_url`, `invoice_id`, `markup_percent`. |
| list_expense_categories | list_expense_categories | Same. Unit-based = category has a unit price. |
| log_time | log_time | Same. Requires the person's active assignment to project + task (checkLoggable); rate derived (INV-2). |
| start_timer | start_timer | Same. Stops *any* running timer of that person (one-running-timer index), not only same-day ones; repeat start within 10 s is a no-op (`already_running`). |
| stop_timer | stop_timer | Same (own timer only). 12-hour cap per run. |
| update_time_entry | update_time_entry | Same params. **No admin override of locks**: approved/invoiced entries, and entries on a draft invoice, are immutable (INV-3/INV-4). Moving project/task/date re-derives billable + rate. |
| delete_time_entry | delete_time_entry | Same; same lock rule (no admin bypass). |
| create_expense | create_expense | Same (`total_cost` or `units`). Units are converted to a total via the category unit price. |
| update_expense | update_expense | Same; `delete_receipt` clears the receipt link. Invoiced (incl. on a draft) → `validation_failed`. |
| create_client | create_client | Same. Currencies: USD, EUR, GBP, CAD, AUD. |
| update_client | update_client | Same. Archiving isn't blocked by active projects (Track2 rule: their projects stop accepting time). Currency is locked once the client has invoices. |
| create_project | create_project | Same incl. `rate_status`. Rates/fees need `view_billable_rates`. Extra `fee` for fixed-fee projects (`fee_status`). Creator becomes PM; common tasks and all-projects people are added. |
| update_project | update_project | Same incl. `rate_status` (`ignored_bill_by`). Extra `fee`. PMs only on projects they manage. |
| create_task | create_task | Same (unique name, `add_to_all_projects`). Rate needs `view_billable_rates`. |
| update_task | update_task | Same, plus `billable_by_default`, `is_default`. A new default rate applies to **new** time only (Track2 stores the rate on each entry), unlike Harvest's retroactive re-price. |
| add_task_to_project | add_task_to_project | Same. |
| remove_task_from_project | remove_task_from_project | Same (`removed`). With tracked time the assignment is deactivated, else deleted. |
| assign_user_to_project | assign_user_to_project | Same. Needs project management (PM: own projects). |
| unassign_user_from_project | unassign_user_from_project | Same (`removed`). |
| create_invoice | create_invoice | Draft only. Line `kind` must be a Track2 item type (Service/Product…). `currency` must equal the client's. `payment_term` phrases: upon receipt, net 15/30/45/60. `payment_options` not supported (Stripe is per entity). |
| create_invoice_from_tracked_time | create_invoice_from_tracked_time | Draft only, over `modules/invoicing/generateInvoice.ts`: fixed-fee projects get one remaining-fee line and their hours stay uninvoiced; missing rates block generation. `time.summary_type` → grouping; `expenses.summary_type` / `attach_receipts` accepted but Track2 adds one line per expense. |
| search_help_center | — | Not applicable. |
| submit_feedback | — | Not provided (use BugHerd / Slack). |
| — (not in v1) | send_invoice, record_payment, delete_invoice | Deliberately omitted: outbound email / money movement. Future, behind `manage_invoices` + an explicit `confirm: true` argument and audit. |

## Non-functional
- **Reuse the service layer** — no business logic in the MCP tier.
- **Performance** (specs/21) — no unbounded `findMany` over `TimeEntry`: lists are keyset-paginated on
  `(spentDate, id)` within a date range (default last 30 days; uses `TimeEntry(accountId, spentDate)`), reports
  aggregate in SQL. Lookup tables (clients, tasks, users, categories) are small and filtered in memory.
- **Limits** — 120 req/min per token per instance (in-memory; a guard against runaway loops, not a quota).
- **Audit** — one `AuditLog` row per write call (success or refusal) plus the domain rows.
- **Errors** — never leak internals (`internal_error` with a generic message; details go to server logs).

## Tests
`modules/apiTokens/token.test.ts` (mint/hash/verify/Bearer parsing), `modules/mcp/schema.test.ts` (input
validation), `cursor.test.ts`, `scope.test.ts` (Member/PM/Accounting/Admin mapping + overrides),
`format.test.ts` (hours/clock/money/terms, search, audit), OAuth: `modules/oauth/{crypto,redirectUri,metadata,requests,service}.test.ts`
(PKCE, redirect URIs, registration/authorize validation, consent origin, client auth, code/token lifecycle incl.
reuse + refresh-rotation reuse detection, against an in-memory store), `modules/shared/safeRedirect.test.ts`,
`app/api/mcp/route.test.ts` (401 + `WWW-Authenticate`, OAuth token accepted, deactivated user refused), `jsonrpc.test.ts` (initialize, tools/list,
tools/call happy/forbidden/validation, batches, rate limit), `lib/mcp/registry.test.ts` (real registry with mocked
Prisma: advertised tool names, member/PM/invoice permission checks), `modules/time/editEntry.test.ts`.

## Deferred / decisions
- OAuth: no scopes (a grant acts with the user's full permissions, like a PAT); no cleanup job yet for unused
  registered clients / expired codes (rows are tiny; a periodic `DELETE` of codes older than a day and clients with
  no grants older than a week is enough); rate limits are per instance.
- `send_invoice`, `record_payment`, `delete_invoice` (see table); `get_client`, `get_project`,
  `get_profitability`, `get_receivables`, `get_uninvoiced`, `create_person`.
- Shared rate limiting (per-instance today) and a versioned REST surface (`/api/v1/…`) over the same tool layer.
- `app/projects/actions.ts` and `app/timesheet/actions.ts` could adopt `modules/projects/projectSetup.ts` /
  `modules/time/editEntry.ts` so the UI and API share one implementation.

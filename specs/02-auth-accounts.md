# 02 — Auth, Accounts & Permissions

## Authentication

- Email + password, hashed with Argon2id (or bcrypt cost ≥ 12). Sessions via Auth.js (httpOnly, secure, SameSite=Lax cookies).
- Passwords: min 10 chars, checked against a breached-password list on set.
- Rate limiting: 5 failed logins / 15 min / IP+email → temporary lockout.
- Password reset via single-use, 30-min-expiry token emailed to the user.
- No public self-serve signup flow required in phase 1; the first admin is created by seed/CLI, and admins invite users.

## Identity & account security (observed)

Harvest separates **identity** (a central "Harvest ID" shared across Harvest/Forecast — holds password, session length, open sessions, personal 2FA) from **account membership**. Model a central `Identity` (credentials) linked to per-account `User` rows; a person could in principle belong to multiple accounts (phase 1 may keep 1:1 but keep the seam).

**Account-level security settings** (Settings → Sign in security):
- **Require 2FA** for all members (may be forced on by an integration, e.g. Xero).
- **Require sign in with Google** (Google auth for all members).
- **SAML SSO** with an identity provider (Premium).

- **AC-AUTH-SEC-1** — *Given* account `require2FA=true`, *when* a member without 2FA signs in, *then* they are forced through 2FA setup before access.
- **AC-AUTH-SEC-2** — *Given* `requireGoogleSignIn=true`, *when* a member attempts password login, *then* they are redirected to Google auth.

## Account provisioning

- One Account = one workspace/tenant. A User belongs to exactly one Account (phase 1 — no multi-account membership).
- Creating an Account creates its first `admin` user.
- Account settings (currency, timezone, week start, rounding, number sequences) are editable by `admin` only.

## Permission model — 6 customizable profiles (revised from live observation)

Harvest does **not** use a 3-role model. Each person has a base **permission profile** (customizable via granular overrides), plus a single **Account Owner** designation (billing owner). A person's descriptive "Roles" tags (Designer, Biz Dev) are labels, not permissions.

**Base profiles** (each a starting template you can customize):

| Profile | Summary (from the live Permissions screen) |
|---|---|
| **Member** | Track time & expenses on assigned projects. |
| **Project Manager** | Manage projects, clients, tasks; view/edit time & expenses for their team. **No** access to rates, invoices, people, or account settings. |
| **People Admin** | Manage people and all time entries & expenses across the account. **No** access to rates, invoices, or account settings. |
| **Accounting** | Manage invoices, estimates, expenses, clients; view rates & reports. **No** access to people or account settings. |
| **Executive Manager** | Manage time, expenses, projects, people, invoices, reports; view rates. **No** access to account settings or billing. |
| **Administrator** | Full access to everything, including account settings and billing. |

**Capability matrix** (base profiles; `overrides` can grant/revoke individual capabilities):

| Capability | Member | Project Mgr | People Admin | Accounting | Exec Mgr | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Edit account settings / billing | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage people & permissions | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| View billable rates | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| View **cost** rates | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Set person billable/cost rates | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Create/edit clients | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Create/edit projects & assignments | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Manage global task list | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Track own time/expenses | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View/edit others' time & expenses | ❌ | ✅ (their team) | ✅ (all) | ❌ | ✅ (all) | ✅ |
| Approve/reopen timesheets¹ | ❌ | ✅ (their team) | ✅ | ❌ | ✅ | ✅ |
| Manage invoices/estimates & payments | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Run reports | own | team | all time/exp | financial+rates | all | all |

¹ Only when the **Timesheet approval** module is enabled (off at Big Sea).

**Cost-rate visibility is Admin-only; billable-rate visibility is Admin + Accounting + Exec Mgr** (matches the live Rates screen note).

Permission checks live in `modules/shared/permissions.ts` as pure predicates `can(actor, capability, resource)` that read `profile + overrides`. UI hides disallowed actions; the **service layer re-checks every action** (defense in depth). Never trust the client.

## Acceptance criteria

- **AC-AUTH-001** — *Given* a valid email/password, *when* a user logs in, *then* a session cookie is set and they land on the time-tracking screen for the current week.
- **AC-AUTH-002** — *Given* 5 consecutive failed logins for an email, *when* a 6th is attempted within 15 min, *then* it is rejected with a lockout message regardless of password correctness.
- **AC-AUTH-003** — *Given* a `member`, *when* they request another user's time entries via API, *then* the service returns 403 (not an empty list — an explicit denial).
- **AC-AUTH-004** — *Given* a **Project Manager** profile (no invoice capability), *when* they attempt to create an invoice, *then* the action is denied at the service layer even if the API is called directly; *given* an **Accounting** profile, the same call succeeds.
- **AC-AUTH-004b** — *Given* a non-Admin profile, *when* they open a project or report, *then* **cost rates** are never returned in the payload (Admin-only); billable rates appear only for Accounting/Exec/Admin.
- **AC-AUTH-005** — *Given* a user in Account A, *when* they reference any entity id belonging to Account B, *then* the operation returns not-found/403 (tenant isolation, **INV-5**).
- **AC-AUTH-006** — *Given* a `member` who is `isProjectManager` on Project X, *when* they edit a teammate's time entry on Project X, *then* it succeeds; *when* they edit one on Project Y, *then* it is denied.
- **AC-AUTH-007** — *Given* a deactivated user, *when* they attempt login, *then* it is refused, but their historical time entries remain visible in reports.
- **AC-AUTH-008** — *Given* a password reset token, *when* used twice, *then* the second use is rejected (single-use).

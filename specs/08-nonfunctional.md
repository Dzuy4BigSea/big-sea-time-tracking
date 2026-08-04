# 08 — Non-Functional Requirements

Cross-cutting requirements the validation and QA agents assert across all features.

## Security

- **Tenant isolation (INV-5):** every query filters by `accountId` via a repository wrapper; a test suite attempts cross-account access on every entity and expects denial.
- **AuthZ at the service layer:** UI hiding is never the only guard; every mutating service function calls `can(actor, action, resource)`.
- **Input validation:** all inputs parsed by Zod at the boundary; reject unknown fields.
- **Money & injection safety:** parameterized queries only (Prisma); no string-built SQL.
- **Secrets:** no secrets in the repo; `.env` for config; public tokens ≥128-bit CSPRNG.
- **Audit:** every create/update/delete/state-change on Invoice, Payment, TimeEntry(lock), Project(rate), and User(role) writes an `AuditLog` row.
- **Rate limiting** on auth and public invoice endpoints.

## Performance (targets, verified in CI with seeded volume: 50 users, 100 projects, 100k time entries)

- Time-tracking day/week view initial load p95 < 500 ms.
- Invoice generation from a month of entries p95 < 2 s.
- Any report over a 1-year range p95 < 3 s.
- N+1 queries prohibited on list views (asserted by query-count test).

## Reliability & data integrity

- All multi-row invoicing/locking operations run in a DB transaction (reserve entries, create line items, bump number sequence — all-or-nothing).
- Number sequences (`invoiceNumberSeq`, `estimateNumberSeq`) are incremented inside the send transaction with row-level locking to prevent duplicates under concurrency.
- Idempotency: "send invoice" and "start timer" are safe under double-submit (see AC-INV-017, AC-TIME-014).

## Accessibility

- WCAG 2.1 AA: keyboard-operable timers, forms, and tables; visible focus; labels on all inputs; color-contrast ≥ 4.5:1.
- Time entry is fully operable without a mouse (start/stop timer, enter duration, navigate week grid).

## Internationalization / localization

- Currency formatting per invoice currency; dates per account timezone & locale.
- All timestamps stored UTC; presented in account/user timezone.
- Decimal/thousands separators locale-aware in display, canonical in storage/export.

## Observability

- Structured logs with `accountId`/`actorUserId`/request id (never log secrets or full PII).
- Health check endpoint; error tracking hook.

## Acceptance criteria

- **AC-NFR-001** — *Given* the cross-account probe suite, *when* run against every entity, *then* 100% of cross-account reads/writes are denied.
- **AC-NFR-002** — *Given* a mutating action forbidden for a role, *when* invoked directly at the API bypassing the UI, *then* the service rejects it (UI-independent authz).
- **AC-NFR-003** — *Given* a malformed payload with extra/invalid fields, *when* posted, *then* Zod rejects it with a 400 and no partial write.
- **AC-NFR-004** — *Given* seeded volume (100k entries), *when* the week view loads, *then* p95 < 500 ms and the query count is bounded (no N+1).
- **AC-NFR-005** — *Given* two concurrent "send invoice" calls in one account, *when* both run, *then* no duplicate invoice number is issued (sequence integrity).
- **AC-NFR-006** — *Given* a rate/role/state-change mutation, *when* it completes, *then* a corresponding `AuditLog` row exists with before/after.
- **AC-NFR-007** — *Given* the time-entry UI, *when* operated by keyboard only, *then* a user can start/stop a timer and enter a duration with no mouse.
- **AC-NFR-008** — *Given* an invoicing transaction that fails midway (simulated), *when* it rolls back, *then* no entries are left reserved and no number is consumed.

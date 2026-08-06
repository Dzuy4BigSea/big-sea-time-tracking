# Development Time Log — Track2 (Time Tracking & Invoicing Platform)

A running log of actual development and working-session time on the Track2 project, kept so hours can be pulled by date and later entered into our time tracker. Maps to the R&D project **"R&D – Track2 Time Tracking & Invoicing Platform."**

**How to read this:** one row per working session. `Hours` for past sessions are **estimates reconstructed from git commit activity** (commit timestamps + scope of work in each window) — treat them as a starting point and adjust to actual where known. New sessions are appended as they happen.

**R&D task categories** (per the R&D Tax Credit Tracking Guide): Research & Discovery · Technical Design & Architecture · Development / Configuration · Testing & QA · Debugging & Iteration. When entering into the tracker, exclude non-qualifying time (learning, routine styling, PM) per the guide.

| Date | Session | Hours (est.) | R&D task category | Notes |
|---|---|---:|---|---|
| 2026-08-04 | Discovery & spec set | 1.5 | Research & Discovery | Defined the platform scope and wrote the testable specification/acceptance-criteria set that drove the build. |
| 2026-08-04 | Foundation build | 5.0 | Technical Design & Architecture; Development | Data model + Prisma schema + deterministic seed; core business-logic modules with unit tests (effective-dated rate resolution, integer-cents money math, duration math, invoice totals, invoice state machine, permission/capability layer); provisioned the Postgres database; scaffolded the Next.js app + first live screens. |
| 2026-08-05 | Core billing loop | 0.5 | Development / Configuration | Completed the track → invoice → send → record-payment loop; first reporting screens. |
| 2026-08-05 | Auth & multi-tenancy | 2.5 | Technical Design & Architecture; Development | Session-based authentication; per-account (multi-tenant) data scoping; adopted real database migrations; entity create forms. |
| 2026-08-05 | Entity CRUD | 1.0 | Development / Configuration | Edit forms for core entities; expense entry + categories; inline timesheet editing. |
| 2026-08-06 | Modules & billing features | 2.0 | Development / Configuration; Testing & QA | Account settings + feature-module gating; billing expenses onto invoices; prepaid retainers; recurring-invoice profiles + scheduled generation; estimates + conversion; automated tenant-isolation test suite. |
| 2026-08-06 | Integrations & reporting depth | 2.5 | Development / Configuration; Testing & QA; Debugging & Iteration | Third-party integrations (online payments, accounting sync, project-management import) with an encrypted-at-rest credential store + admin UI; signature-verified idempotent payment webhooks; reporting period/grouping depth; project team assignment; shared time-entry interface. |

**Running total (estimated): 15.0 hours** _(through 2026-08-06)_

---

### Appending new sessions
Add a row with: date, a short session name, estimated hours, the R&D task category, and a one-line technical note (what was built/tested and the uncertainty being worked through). Keep notes specific enough to be defensible for R&D review, e.g. _"Testing idempotency of inbound payment webhook against duplicate delivery."_

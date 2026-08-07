# 16 — Business entities (multi-brand invoicing)

## Why
Big Sea operates two companies out of one shared workspace: **Big Sea** and **Cordelia Labs** (a Big
Sea–owned company). The team is shared — people work across both — but each company must invoice as
itself: its own **sender email**, **branding**, **Stripe account**, and **Xero organisation**. Money
and branding have to route to the right company automatically. Asana is shared (one workspace).

Projects and clients are informally tagged today (`BS:` / `CL:` prefixes). This spec makes the
designation a first-class flag that drives invoice routing.

## Model

A **BusinessEntity** is a brand/company *inside* a single Account — **not** a separate account. The
team, login, timesheets, tasks, and Asana stay shared; only invoicing-facing concerns split.

```
Account (Big Sea workspace)
├── BusinessEntity  "Big Sea"        code BS   isDefault=true
└── BusinessEntity  "Cordelia Labs"  code CL
```

Every entity-taggable record defaults to the account's **default entity (Big Sea)** unless designated
Cordelia — so nothing breaks for records created before this feature, and imported Harvest data lands
on Big Sea until a human re-tags it.

### `BusinessEntity` (account-scoped)
| field | notes |
|---|---|
| `id`, `accountId` | |
| `name` | "Big Sea", "Cordelia Labs" |
| `code` | short tag shown in the UI: `BS`, `CL` (unique per account) |
| `isDefault` | exactly one per account; the fallback for everything |
| `isActive`, `sortOrder` | |
| `senderName`, `senderEmail`, `replyToEmail` | outbound invoice identity |
| `brandColor`, `logoFileUrl`, `documentTitle` | invoice branding (falls back to account `InvoiceAppearance`) |

### Entity flags on existing models
- `Client.entityId` → **drives invoice routing** (invoices are billed per client). Default = BS.
- `Project.entityId` → the project designation the team already uses. Default = BS.
- `User.homeEntityId` → a person's home company (for defaults/reporting). Default = BS. People still
  work across both; this is a default, not a restriction.
- `Invoice.entityId` → **stamped at creation from the client's entity**, overridable before send. Once
  set it is the single source of truth for that invoice's sender/branding/Stripe/Xero.

### Integration routing (`IntegrationConnection.entityId`)
- `entityId = null` → **shared / account-wide** connection (Asana).
- `entityId = <entity>` → entity-specific connection (**Stripe**, **Xero**).
- Uniqueness becomes `(accountId, provider, entityId)`. A partial unique guards a single shared row
  per provider where `entityId IS NULL`.
- Resolution `getConnectionWithSecrets(accountId, provider, entityId?)`:
  1. if `entityId` given, try `(accountId, provider, entityId)`;
  2. else / not found, fall back to the shared row `(accountId, provider, NULL)`.
  Asana always resolves to the shared row; Stripe/Xero resolve to the invoice's entity.

## Behaviour / acceptance

- **AC-ENT-001** An account has ≥1 entity; exactly one `isDefault`. Big Sea's account seeds two:
  Big Sea (default) + Cordelia Labs.
- **AC-ENT-002** New Client / Project / Person forms show an entity selector defaulting to Big Sea; a
  `BS`/`CL` chip renders wherever the record is listed.
- **AC-ENT-003** Creating an invoice stamps `Invoice.entityId` from the client's entity; the composer
  lets an admin override it before sending.
- **AC-ENT-004** Sending an invoice uses the **entity's** sender identity (from/reply-to) and branding
  (color/logo/title), falling back to the account default when the entity leaves a field blank.
- **AC-ENT-005** The public invoice page + PDF render the invoice entity's branding.
- **AC-ENT-006** "Pay" on an invoice routes to the **entity's Stripe account**; its webhook verifies
  against that entity's signing secret and records the payment against the right invoice.
- **AC-ENT-007** Copy-on-send / payment copy routes to the **entity's Xero organisation**. If the
  entity has no Xero connection, it no-ops (same as today) rather than using the other entity's.
- **AC-ENT-008** Asana import stays account-wide (shared workspace) — unaffected by entity.
- **AC-ENT-009** Integrations settings can connect Stripe and Xero **per entity** (Big Sea / Cordelia
  toggle); Asana shows once, shared.
- **AC-ENT-010** Reports and lists can filter by entity (nice-to-have; ships after the routing core).

## Build order (phased, each phase tested + committed)
1. **Data model** — `BusinessEntity`, entity flags on Client/Project/User/Invoice, `entityId` on
   IntegrationConnection; migration; seed two entities + backfill existing rows to BS. Resolution
   service (`resolveInvoiceEntity`, entity-aware `getConnectionWithSecrets`) + unit tests.
2. **Integration routing** — per-entity Stripe (pay + webhook) and Xero (copy-on-send + payment copy);
   integrations settings per-entity UI.
3. **Send-time identity + branding** — per-entity sender + appearance on invoice send, public page, PDF.
4. **Designation UI** — entity selector + `BS`/`CL` chips on Client/Project/Person forms & lists;
   invoice composer override; optional entity filter on lists/reports.

## Deferred / poll the ops manager later
Per-entity number sequences, per-entity retainers/recurring defaults, restricting who can bill for an
entity, per-entity report packs, and entity-level P&L are **nice-to-haves** — gather the ops manager's
wishlist before building. This spec commits only to the routing core above.

## Open decisions (resolved)
- Entities live **inside one Account** (shared team/login/Asana) — confirmed.
- Invoice entity is **driven by the client**, overridable per invoice — confirmed.
- Stripe/Xero connected **per entity in-app** (Asana shared) — confirmed.

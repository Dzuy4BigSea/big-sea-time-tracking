# 14 — Integrations: Asana, Stripe, Xero

Grounded against Harvest's live **Settings → Integrations** on the Big Sea account (2026-08-06). Big Sea has **Asana**, **Stripe**, and **Xero** connected — these three are the scope of this spec. Harvest offers many more (Basecamp, Jira, Slack, QuickBooks, Zapier, calendar, browser extensions); those are out of scope but the shared connection model below is designed to accommodate them later.

This spec defines: a **shared integration/connection model**, the **Integrations settings surface**, and three integrations — **Asana** (project management), **Stripe** (inbound online payments), **Xero** (outbound accounting sync) — plus the **end-to-end payment lifecycle** that ties Stripe → Track2 → Xero together.

---

## 0. Shared model & settings surface

### Observed (live Harvest)
- Integrations live under **Settings** at `/company/settings/integrations`, grouped by category (Project management · Finance and payments · Communication and CRM · Productivity · Development · Browser extensions).
- Each card shows name, one-line description, and an action: **Connect** (not yet linked), **View settings** (linked), or **Get the extension / Connect in <app>** (external).
- Connected integrations expose a **settings page** (`/asana/settings`, `/stripe_connect/settings`, `/xero/settings`) with a **Disconnect/Unlink** control and the sync configuration.

### Data model (additions)

```prisma
enum IntegrationProvider { asana stripe xero }        // extensible
enum IntegrationStatus   { connected disconnected error }

model IntegrationConnection {
  id           String              @id @default(cuid())
  accountId    String
  account      Account             @relation(fields: [accountId], references: [id], onDelete: Cascade)
  provider     IntegrationProvider
  status       IntegrationStatus   @default(connected)
  // OAuth material — encrypted at rest; never returned to the client.
  accessToken  String?
  refreshToken String?
  expiresAt    DateTime?
  externalOrgId   String?          // Stripe account id / Xero tenant id / Asana workspace gid
  externalOrgName String?          // "Big Sea" — shown in settings ("Connected to … Big Sea")
  connectedByUserId String?
  config       Json?               // provider-specific settings (see each section)
  lastSyncedAt DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@unique([accountId, provider])   // one connection per provider per account
  @@index([accountId])
}

// Append-only audit of every sync attempt (both directions). Powers the
// "Synced N ago" labels and troubleshooting.
model IntegrationSyncLog {
  id         String              @id @default(cuid())
  accountId  String
  provider   IntegrationProvider
  direction  String              // "inbound" | "outbound"
  entityType String              // "invoice" | "payment" | "contact" | "project" | "person"
  entityId   String?             // Track2 id
  externalId String?             // provider-side id (Xero InvoiceID, Stripe pi_…, Asana gid)
  ok         Boolean
  message    String?
  createdAt  DateTime  @default(now())
  @@index([accountId, provider])
  @@index([entityType, entityId])
}
```

Provider mapping ids that must persist on our own rows (added per section): `Invoice.xeroInvoiceId`, `Invoice.stripePaymentIntentId`, `Payment.stripeChargeId`, `Payment.xeroPaymentId`, `Client.xeroContactId`, `Project.asanaProjectGid`, `User.asanaUserGid`.

### Capability gating
- Connecting / disconnecting / editing integration settings requires **`edit_account_settings`** (administrator). Enforce in the settings actions and hide the Settings → Integrations sub-page otherwise.
- Integrations are **account-scoped** (INV-5): all connection rows, tokens, and synced ids carry `accountId`; every sync query is filtered by it.

### Security (non-negotiable)
- OAuth tokens and webhook signing secrets are **secrets**: stored encrypted (or in a secret store), never logged, never sent to the browser. The settings UI shows only `externalOrgName` + status.
- All inbound webhooks (Stripe) **must** verify the provider signature before acting.
- Token refresh is server-side; a refresh failure sets `status = error` and surfaces a "reconnect" prompt.

### Acceptance criteria
- **AC-INT-001** — *Given* a provider is not connected, *when* an admin opens its card, *then* the action is **Connect** and the OAuth flow begins; *given* it is connected, *then* the action is **View settings** and the settings page shows the connected org name + **Disconnect**.
- **AC-INT-002** — *Given* a non-admin, *when* they load `/company/settings/integrations`, *then* it is not accessible (redirect) and no connect/disconnect action is callable.
- **AC-INT-003** — *Given* any connection, *when* stored, *then* exactly one row exists per `(accountId, provider)` and tokens are never present in any client payload or log line.
- **AC-INT-004** — *Given* a token refresh fails, *when* a sync is attempted, *then* `status=error`, the sync is not silently dropped (a `IntegrationSyncLog` row with `ok=false` is written), and the UI shows a reconnect prompt.

---

## 1. Asana (project management)

### Observed
> "Get up and running quickly on Harvest by importing **projects and people from Asana**. Get the **browser extension** to track time using a Harvest clock icon in your Asana tasks."

Two independent capabilities:
1. **Import** — pull Asana **projects** and **people (workspace members)** into Harvest to seed Track2 projects/users.
2. **In-context time tracking** — a browser extension injects a Harvest "start timer" control onto Asana tasks; starting it opens the timer pre-filled with the mapped project/task.

### Scope for Track2 (phase 1)
- **Import from Asana** (server-side OAuth, no extension needed): connect an Asana workspace, list its projects + members, and let an admin **select which to import**. Imported Asana projects create Track2 `Project` rows (mapped `asanaProjectGid`); imported members create/att `User` invites (mapped `asanaUserGid`). Re-running import is **idempotent** (matches on gid; updates name, skips existing).
- **Browser extension** and per-task timer deep-linking are **documented but deferred** (a browser-extension build is a separate track). The timer's start-payload contract is specified so the extension can be added later without server changes.

### Data model
- `Project.asanaProjectGid String? @unique` (per account), `User.asanaUserGid String?`.
- `IntegrationConnection.config` for Asana: `{ workspaceGid, defaultClientId?, autoImportNewProjects: boolean }`.

### Flows
- **Connect**: OAuth2 with Asana → store token + `workspaceGid` (as `externalOrgId`), `externalOrgName = workspace name`.
- **Import**: `GET` Asana projects/users → present a selectable list → on confirm, upsert Track2 rows by gid; log each to `IntegrationSyncLog` (`direction=inbound`, `entityType=project|person`).
- **Timer start contract** (for the future extension): `POST /api/integrations/asana/timer { asanaProjectGid, taskName }` → resolves the mapped Track2 project, picks/creates a matching task, and starts a timer for the current user (reuses `startTimer`).

### Acceptance criteria
- **AC-ASANA-001** — *Given* a connected workspace, *when* an admin runs import and selects 3 projects, *then* 3 Track2 projects exist mapped by `asanaProjectGid`, associated to the chosen client.
- **AC-ASANA-002** — *Given* import is re-run, *when* a project already exists by gid, *then* it is updated (name) not duplicated (idempotent).
- **AC-ASANA-003** — *Given* the (future) extension posts the timer contract for a mapped project, *when* handled, *then* a running timer is created for the current user on the mapped project/task (one-running-timer rules from [04](04-time-tracking.md) still hold).
- **AC-ASANA-004** — *Given* an Asana member with no matching Track2 user, *when* imported, *then* a user invite is created (bcrypt-less, pending) mapped by `asanaUserGid`; an existing email is matched, not duplicated.

---

## 2. Stripe (inbound online payments)

### Observed
> "Receive invoice payments online by **credit card or ACH** payment." Settings (`/stripe_connect/settings`): connected via **Stripe Connect** ("Connected to Stripe account Big Sea associated with andi@bigseadesign.com"), **Available payment methods** synced from Stripe with toggles **Enable credit card payments** and **Enable ACH direct debit payments (USD)** (ACH: fees capped $5, 3–5 business days to clear, newer accounts capped at $2,000). "Stripe will charge a variable fee per transaction."

### Scope for Track2
Add an **online "Pay this invoice" flow** to the public invoice view (`/i/[token]`, see [05](05-invoicing.md)) that charges via Stripe and records the payment back onto the invoice automatically — closing the gap noted in PROGRESS ("online payment needs a provider decision"). **The app never touches raw card/bank data** — payment details are entered in Stripe's hosted Checkout / Payment Element, satisfying the platform rule against handling financial credentials.

### Data model
- `IntegrationConnection.config` for Stripe: `{ stripeAccountId, creditCardEnabled: boolean, achEnabled: boolean, methodsSyncedAt }`.
- `Invoice.stripePaymentIntentId String? @unique`, `Payment.stripeChargeId String? @unique`, `Payment.source String @default("manual")` (`manual` | `stripe`) so Stripe-originated payments are distinguishable.
- Reuse the existing `Payment` model + `recordPayment` service (partial/full/overpayment guards already tested).

### Flows
1. **Connect**: Stripe Connect OAuth → store `stripeAccountId`. Payment methods are enabled in the Stripe Dashboard, then **"Sync from Stripe"** copies the enabled set into `config` (drives which buttons appear to the client).
2. **Client pays** (`/i/[token]`, only when `status = open` and Stripe connected): "Pay $X" → create a Stripe **PaymentIntent** (on the connected account) for the invoice balance → redirect to Stripe-hosted payment → return to a confirmation view.
3. **Webhook** `POST /api/integrations/stripe/webhook`: **verify signature**, then on `payment_intent.succeeded` (or `charge.succeeded`) look up the invoice by `stripePaymentIntentId`, and call `recordPayment` with `{ amountCents, method: 'card'|'bank_transfer', source: 'stripe', stripeChargeId, paidOn }`. **Idempotent** on `stripeChargeId` (a duplicate webhook does not double-record).
4. Recording the payment runs the normal lifecycle: invoice may transition `open → paid`, and (if Xero is connected) triggers the outbound Xero payment copy (§3).

### Acceptance criteria
- **AC-STRIPE-001** — *Given* Stripe connected with credit card enabled, *when* a client opens a sent invoice, *then* a "Pay by card" option appears; ACH appears only if `achEnabled`.
- **AC-STRIPE-002** — *Given* a client completes payment, *when* `payment_intent.succeeded` is received and verified, *then* a `Payment` (`source=stripe`, `stripeChargeId` set) is recorded for the paid amount and the invoice balance decreases; a full payment sets status `paid`.
- **AC-STRIPE-003** — *Given* the same webhook is delivered twice, *when* processed, *then* only **one** payment exists (idempotent on `stripeChargeId`).
- **AC-STRIPE-004** — *Given* a webhook with an invalid/absent signature, *when* received, *then* it is rejected (400) and **no** payment is recorded.
- **AC-STRIPE-005** — *Given* the app UI, *when* a client pays, *then* card/bank details are entered only in Stripe's hosted element — Track2 never receives or stores raw PAN/account numbers (only the Stripe token/ids).
- **AC-STRIPE-006** — *Given* a partial payment via Stripe, *when* recorded, *then* the overpayment guard from [05](05-invoicing.md) still applies and the remaining balance is correct.

---

## 3. Xero (outbound accounting sync)

### Observed
> "Copy Harvest **invoices and payments** to this accounting app, eliminating double entry." Settings (`/xero/settings`): **Linked to Big Sea / Unlink Xero**. "Sending invoices in Harvest will **automatically copy them to Xero**"; manual path = Invoice → **Actions → Copy to Xero**. Config: **Default revenue account** (Xero chart-of-accounts code, e.g. `400.2 - Fee Income`; per-item-code/contact mapping wins, else this default), **Default payment account** ("Copy Harvest payments to" a Xero payments-enabled account — the list includes a **Stripe** account — or **Do not copy Harvest payments to Xero**), and **Tracking categories** ("Populate tracking categories in Xero based on client" vs not).

### Scope for Track2
One-directional **Track2 → Xero** copy of invoices and payments (Xero is the system of record for accounting). On **invoice send**, copy the invoice to Xero as an `ACCREC` invoice; on **payment recorded**, copy the payment against the configured Xero payment account.

### Data model
- `IntegrationConnection.config` for Xero: `{ tenantId, defaultRevenueAccountCode, paymentAccountCode | null (null = "do not copy payments"), populateTrackingByClient: boolean }`.
- `Invoice.xeroInvoiceId String? @unique`, `Payment.xeroPaymentId String? @unique`, `Client.xeroContactId String?`.

### Flows
1. **Connect**: Xero OAuth2 → store `tenantId` (`externalOrgId`) + org name. Load the chart of accounts + payments-enabled accounts to populate the settings dropdowns.
2. **Invoice → Xero** (auto on **send**, or manual **Actions → Copy to Xero**):
   - Ensure the client exists as a Xero **Contact** (create if missing → store `Client.xeroContactId`).
   - Create a Xero **ACCREC invoice**: line items map to the **revenue account** (per item-code/contact mapping, else `defaultRevenueAccountCode`); set reference = Track2 invoice number; optionally set the **tracking category** from the client when `populateTrackingByClient`.
   - Store `Invoice.xeroInvoiceId`; log outbound. **Idempotent**: if `xeroInvoiceId` already set, update rather than create.
3. **Payment → Xero** (on `recordPayment`, incl. Stripe-originated): if `paymentAccountCode` is set, create a Xero **Payment** against the Xero invoice + that account; store `Payment.xeroPaymentId`. If config = "do not copy payments", skip. This is how a **Stripe** card payment lands in the Xero "Stripe" clearing account — the full **Stripe → Track2 → Xero** path.

### Acceptance criteria
- **AC-XERO-001** — *Given* Xero connected, *when* an invoice is **sent**, *then* it is copied to Xero as an ACCREC invoice, `xeroInvoiceId` is stored, and re-sending/copy updates (not duplicates) it.
- **AC-XERO-002** — *Given* a client with no `xeroContactId`, *when* their invoice is copied, *then* a Xero Contact is created first and the id is stored; an existing contact is reused.
- **AC-XERO-003** — *Given* a line item with no item-code/contact revenue mapping, *when* copied, *then* it posts to `defaultRevenueAccountCode`.
- **AC-XERO-004** — *Given* `paymentAccountCode` is set, *when* a payment is recorded in Track2 (manual **or** Stripe), *then* a Xero Payment is created against the Xero invoice + that account and `xeroPaymentId` is stored; *given* "do not copy payments", *then* no Xero payment is created.
- **AC-XERO-005** — *Given* `populateTrackingByClient`, *when* an invoice is copied, *then* its Xero tracking category is set from the client.
- **AC-XERO-006** — *Given* a copy fails (Xero API error/token expired), *when* attempted, *then* an `IntegrationSyncLog` row with `ok=false` is written, the Track2 invoice/payment is unaffected, and the failure is retryable (no partial/duplicate Xero records).

---

## 4. End-to-end payment lifecycle (Stripe → Track2 → Xero)

The three integrations compose into the money path Big Sea runs today:

```
1. Invoice generated in Track2 (time + expenses)         [05, 09]
2. Invoice SENT  ── auto ──▶ copied to Xero (ACCREC)     [AC-XERO-001]
3. Client opens /i/[token], pays by card/ACH via Stripe  [AC-STRIPE-001]
4. Stripe webhook (verified) ─▶ recordPayment(source=stripe) in Track2   [AC-STRIPE-002/003/004]
5. Payment recorded ── auto ──▶ copied to Xero against the Stripe account  [AC-XERO-004]
6. Invoice balance → 0 ⇒ status `paid`; dashboards/AR update             [05]
```

- **AC-FLOW-001** — *Given* all three connected, *when* a client pays a sent invoice in full via Stripe, *then* end-state is: Track2 invoice `paid` with a `source=stripe` payment; a Xero ACCREC invoice marked paid via a Xero payment on the Stripe account; and matching `IntegrationSyncLog` rows — with **no double-entry** and **no duplicate** payments on retry.
- **AC-FLOW-002** — *Given* retainer deposits, *when* revenue/paid metrics are computed, *then* Stripe-originated invoice payments count as paid but retainer deposits remain excluded ([10](10-recurring-retainers.md), AC-RET-002).

---

## 5. Build order (phased)

Each phase is independently shippable and testable; business logic (mappers, idempotency, signature verification, payment recording) lives in `modules/integrations/*` as pure/tested functions, with thin API-route + settings-action wrappers (same layering as the rest of the app).

1. **Shared model** — `IntegrationConnection` + `IntegrationSyncLog` + migration; Settings → Integrations catalog page (read-only cards + connect/disconnect stubs), admin-gated. (AC-INT-*)
2. **Stripe** — highest Big Sea value (get paid): connect, public-invoice pay flow, verified idempotent webhook → `recordPayment`. (AC-STRIPE-*)
3. **Xero** — connect + invoice-on-send copy + payment copy (completes the money path). (AC-XERO-*, AC-FLOW-*)
4. **Asana** — connect + project/people import (idempotent); document the extension timer contract. (AC-ASANA-*)

**Prereqs / decisions needed before build:** Stripe & Xero & Asana OAuth app credentials (client id/secret, webhook signing secret) provisioned as server env vars; a secret-storage decision for per-account tokens; confirmation that Xero sync stays one-directional (Track2 → Xero) for phase 1.

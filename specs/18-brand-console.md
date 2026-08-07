# 18 — Per-company brand console (multi-brand, phase 2)

Extends [16 — Business entities](16-business-entities.md). Spec 16 shipped the routing core: money,
branding, Xero, and sender identity already follow an invoice's `BusinessEntity`. What's missing is a
**single place per company** to see and edit everything that makes that company *look and sound* like
itself — instead of scrolling one long Integrations page and hoping you're editing the right row.

## Why
Big Sea runs Big Sea + Cordelia Labs (and may add a third company) from one workspace. Today:
- **Integrations** lists Stripe/Xero grouped by *provider*, with a per-company row buried under each.
  You scroll and squint to confirm you're editing the right company's Stripe.
- **Invoice appearance** is account-wide with only color/logo/title overridable per entity — no accent
  color, and no per-company control surface.
- **System emails** all render one hard-coded Big Sea shell (dark + lime). Cordelia's receipts look
  like Big Sea's. Email language is fixed in code.

## What we're adding
A **company selector at the top** of the integrations/branding area. Pick a company tab → everything
below is scoped to that company:

1. **Connections** — that company's Stripe + Xero (per-entity), the shared email/SendGrid key with
   *this company's* sender identity (from-name / from-email / reply-to), and shared Asana shown as
   "shared across companies."
2. **Invoice branding** — logo, brand color, **accent color**, company (document) name/title. Live
   preview. Falls back to the account default when a field is blank.
3. **Invoice language** — per-company field-label overrides (the Configure → Field labels set), so
   Cordelia can say "Bill to" where Big Sea says "Invoice for." Falls back to account labels.
4. **Email theme + language** — per-company email header/background/accent colors *and* per-company
   message templates (subject + body for invoice / reminder / receipt). Falls back to account
   templates, which fall back to the built-in defaults.

Companies are manageable: add / rename / set-default / deactivate a company (needed for "a third
company etc").

## Model changes
Add to **`BusinessEntity`** (all nullable → fall back to account default):
| field | notes |
|---|---|
| `accentColor` | secondary brand color for invoice + email accents |
| `emailBrandColor` | email header band color (defaults to `brandColor`) |
| `emailAccentColor` | email button / rule accent (defaults to `accentColor`) |

Make **`InvoiceLabels`** and **`InvoiceMessageTemplate`** entity-aware by adding a nullable
`entityId`. `null` = account default; a row with `entityId` overrides for that company. Resolution:
`entity row → account row (entityId null) → built-in default`. (Unique keys become
`(accountId, entityId, …)`.)

## Resolution rules (unchanged philosophy from 16)
Blank/absent always falls through to the next level up. Nothing is required at the entity level; a new
company with no branding renders exactly like Big Sea's account defaults until someone themes it.

## Acceptance
- **AC-BC-001** Integrations/branding shows a company tab bar; the default company is selected first.
  Switching tabs re-scopes connections + branding + language + email panels to that company.
- **AC-BC-002** Each company tab shows its own Stripe + Xero connect forms, the shared email key with
  that company's sender identity fields, and Asana marked shared.
- **AC-BC-003** Editing a company's logo / brand color / accent color / name updates the public
  invoice + PDF for that company's invoices only; blank fields fall back to the account appearance.
- **AC-BC-004** A company's field-label overrides render on that company's invoices; other companies
  and un-tagged invoices keep the account labels.
- **AC-BC-005** A company's email theme colors + message templates apply to system emails for that
  company's invoices; fallback chain entity → account → built-in default holds at every field.
- **AC-BC-006** Admins can add a company (name + code), rename it, set default, and deactivate it;
  exactly one default always remains.
- **AC-BC-007** All of the above is gated on `edit_account_settings`.

## Build order (each phase tested + committed)
1. **Schema** — entity color fields; `entityId` on `InvoiceLabels` + `InvoiceMessageTemplate`;
   migration; regenerate. Resolver helpers updated to take an optional `entityId`.
2. **Integrations → company tabs** — reorganize the page around a company selector; per-company
   connections + sender identity; keep Asana shared. Company add/rename/default/deactivate.
3. **Brand console** — per-company invoice branding (incl. accent) + invoice language editor, with a
   live invoice preview. Wire accent + labels into the public/print renderer.
4. **Email theme + language** — parameterize the email shell by entity colors; per-company message
   templates; wire the entity fallback into every send.

## Deferred
Per-company number sequences, per-company from-domain verification flow (DKIM), and multiple sender
addresses per company remain nice-to-haves — revisit after the console lands.

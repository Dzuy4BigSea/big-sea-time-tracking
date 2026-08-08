# 17 — UI / functional audit (built vs. Harvest)

Purpose: reconcile what the fidelity specs (05, 12, …) *describe* against what is actually *built*,
control by control, per screen. Grounded in a code inventory (2026-08-06), not memory. Use this to
prioritize — it is the tracker the project was missing.

**Legend:** ✅ built · 🟡 partial (works but incomplete vs Harvest) · ❌ missing · 🗄️ schema exists, no UI

---

> **Update 2026-08-07:** the invoice-detail gaps below are now **built** — edit invoice + blank
> composer, activity/history log, Actions menu (write-off / duplicate / resend / manual Xero copy),
> and print/PDF. Rows kept for history; see the ✅ notes. Remaining open areas: timesheet approval,
> expense edit/receipts, per-project rates, team detail/permissions (next), reports depth.

> **Update 2026-08-07 (later):** further built — global top-bar **search** (invoices/projects/
> clients/tasks/people), **Reports → Expenses** report + CSV, dashboard KPI widgets, the **Invoice
> Configure** suite (field labels, email messages, item types, sender addresses — P3.8), and the
> **per-company brand console** (spec 18): company-tabbed Integrations, per-company branding/accent/
> sender/email-theme, and per-company invoice language + email messages. Correctness bugs B1–B10 are
> all fixed. Remaining open: timesheet submit/approve (module off at Big Sea), estimates public
> `/e/[token]` + editor, remaining report types (utilization/payments/uninvoiced), settings depth.

> **Update 2026-08-08 (real-data audit pass):** with the full Harvest migration loaded, re-audited
> the core list/detail screens against live volume and refined each: **Team** (Members week view +
> utilization + Assignments tab), **Projects list** (client/manager filters, budget/spent/remaining,
> monthly-reset scoping), **Project detail** (chart + 5 cards + tabs + task breakdown), **Clients**
> (A/R table), **Tasks** (filters + usage), **Invoices list** (fixed empty chart, controls, sort,
> pagination), and a shared **ColumnChart** with reference lines. All now aggregate in the DB (no
> loading 388k rows). Open loose ends tracked below.

## Open loose ends (tracked 2026-08-08)
Small, deliberately-deferred items so they don't get lost. Not blockers.
- **Invoices list:** no **Balance sort** (computed field — needs raw SQL ordering) and no **Columns
  chooser** (Harvest has both). Sortable on issue/due/number/client only.
- **Team member detail:** the Members-tab Actions menu deep-links to `/team/[id]?tab=rates` and
  `?tab=permissions`, but the detail page may not read `?tab=` yet — wire it or drop the params.
- **Expenses screen:** not yet given the real-data audit/refine pass (filters, scale check).
- **Reports:** utilization/capacity, payments, uninvoiced report types still missing; period selector
  only on Time; CSV only on Time/Expenses; no charts on Profitability/Receivables.
- **Migration follow-ups:** see [19-migration-followups.md](19-migration-followups.md) — PM-flag
  breadth, 7 partially-paid invoices vs Xero, estimates 403 re-pull, cost/billable-rate backfill.
- **Deferred earlier:** timesheet submit/approve (module off at Big Sea); estimates public
  `/e/[token]` + editor; recurring auto-send.

## Summary — biggest gaps
| Area | State | Headline gaps |
|---|---|---|
| Invoice detail | ✅ | edit, history log, Actions menu, write-off/duplicate/resend/manual-Xero, print/PDF all shipped (2026-08-07); reminder-email still pending (needs email provider) |
| Invoice create | ✅ | blank/manual composer + line-item editing shipped; "generate from tracked time" still available |
| Timesheet approval | ❌ 🗄️ | `Timesheet` model exists but **no submit/approve UI or code path** at all |
| Expenses | 🟡 | create-only — no **edit/delete**, no **receipt upload** UI (field exists) |
| Project detail | 🟡 | no **per-person / per-task rates** UI, no budget-vs-actual bar, no task assignment UI, no archive |
| Team | ✅ | member detail hub built (2026-08-07): Basic info, Rates (billable+cost), Assigned projects (+manages +assign-to-all), Assigned people, Permissions (granular overrides, enforced), Security. Still pending: email-based invite/resend (needs email provider) |
| Reports | 🟡 | only Time/Profitability/Receivables; no Expenses/utilization report; export + period only on Time |
| Activity log | ❌ 🗄️ | `AuditLog` model exists but is **never written or displayed** anywhere |
| Notifications / emails | 🟡 | SendGrid pipeline built (2026-08-07) — invoice send/resend now emails the client, per-entity sender; remaining sends (receipts, reminders, digests, invites, password reset) reuse it — follow-ups |

---

## Invoices

### Invoice detail — `/invoices/[id]`
| Control (Harvest) | Status | Notes |
|---|---|---|
| Balance display | ✅ | top-right |
| Record payment | 🟡 | works, but only in a "Payments" section when `open` — not a top-line "Record payment" |
| Send invoice (draft→sent) | ✅ | `sendInvoiceAction`; auto-copies to Xero |
| Resend invoice | ❌ | no re-send once sent |
| Mark as draft | ✅ | when `open` |
| Delete draft | ✅ | draft only |
| Copy invoice link | 🟡 | "View client link ↗" opens it; no copy-to-clipboard |
| **Edit invoice** | ❌ | no editor for client/dates/subject/notes/terms/discount/tax/line items |
| **Actions ▾ menu** | ❌ | controls are flat buttons; no consolidated menu |
| Duplicate | ❌ | — |
| Create recurring | ✅ | when line items exist |
| Write off invoice | ❌ 🗄️ | `written_off` status handled in display logic, no action sets it |
| Set up reminder email | ❌ | — |
| Use current style | ❌ | — |
| Manual "Copy to Xero" | ❌ | Xero copy only fires automatically on send/payment |
| **Preview / PDF / Print** | ❌ | no PDF, no print view, no download (internal or public) |
| **Invoice history / "View history"** | ❌ 🗄️ | no sent/viewed/paid timeline; `AuditLog` unused |
| **Edit info** (client block) | ❌ | — |
| Attach file / expense report | ❌ | — |
| Payment edit/delete | ❌ | payments are append-only |

### Invoice list — `/invoices`
| | Status | Notes |
|---|---|---|
| Generate draft from tracked time | ✅ | the only creation path |
| New blank / manual invoice | ❌ | no composer |
| Filters / status tabs / search / sort | ❌ | plain table + open/paid tiles |
| Per-row actions | ❌ | row links only |

### Public invoice — `/i/[token]`
Pay via Stripe ✅ (when connected + open + balance>0) · paid banner ✅ · everything else read-only · PDF/download ❌.

### Recurring `/recurring`, Retainers `/retainers`, Estimates `/estimates`
Recurring: create / generate-due (manual) / pause-resume / delete ✅; no scheduled auto-generation (manual stand-in), no detail route. Retainers: create / deposit / drawdown / archive ✅; no per-transaction ledger. Estimates: create / send / accept / decline / convert-to-invoice / delete ✅; no editor, no PDF, no public `/e/[token]` view (token is generated but unused).

---

## Time tracking & expenses

### Timesheet — `/timesheet`
Start/stop timer ✅ (top bar + modal), duration entry ✅, prev/next week ✅, per-entry edit/delete ✅ (lock-aware), weekly grid ✅ (display-only).
- **Start–end time entry** ❌ (duration or free timer only).
- **Submit / approve workflow** ❌ 🗄️ — `Timesheet` model + `approved` lock state exist but **no code path references them**; no submit/approve buttons.
- Copy previous week ❌ · bulk actions ❌ · per-cell grid editing ❌ · time-entry billable toggle ❌ (auto-resolved by rate rules).

### Expenses — `/expenses`
Create expense ✅ (project/category/date/amount/markup/billable/notes), manage categories ✅ (admin).
- **Edit / delete expense** ❌ (create-only; rows non-interactive).
- **Receipt upload** ❌ 🗄️ (`receiptFileUrl` only set by the importer; no file input).
- Unit-based (mileage) entry ❌ (category has unit price, form takes flat amount) · bulk actions ❌ · no expenses→invoice button here (lives in invoice generate).

---

## Projects / Clients / Tasks / Team

### Projects
List ✅ (create, links) — no filter/search/sort/archived view. Create ✅ (type, rate method, budget). Detail ✅ (stat tiles, team assign + PM toggle, recent time). Edit ✅.
- **Per-person & per-task project rates** ❌ — `billableRateMethod` offers person/task but no UI to enter those rates.
- **Assign/remove tasks on a project** ❌ (tasks only auto-added via "Common" flag at creation).
- Budget-vs-actual progress bar ❌ · per-person/per-task hours breakdown ❌ · budget methods limited to none/hours_total/fee_total (others 🗄️).
- **Archive / restore / delete project** ❌ (only passive "(archived)" label).

### Clients
List ✅ / detail ✅ (projects + invoices + A/R tiles) / edit ✅.
- Contact management ❌ (only one contact addable at client-create; detail contacts read-only).
- "New invoice / new project" from client detail ❌ · archive/delete ❌.

### Tasks
List ✅ / create ✅ / edit ✅. Archived tasks hidden, no restore UI ❌.

### Team — `/team`
List ✅ / create ✅ / edit ✅ (name, profile, type, capacity, active, password reset).
- **"Invite" is direct account creation** — no email invite, no invite token, no **resend invite** ❌.
- **Cost rate / billable rate on a person** ❌ 🗄️ (`view_cost_rates`/`set_rates` capabilities + rate tables exist; no UI).
- No member **detail** page (list + edit only) · no capacity scheduling · no roles/skills.

---

## Home / Reports / Settings

### Home `/`
Time / Invoice / Recurring+Retainer summary cards ✅, recently-active projects w/ budget bars ✅.
- Missing widgets: uninvoiced (home), overdue/receivables, team capacity/utilization, per-user week-vs-capacity, date-range control.

### Reports
Time ✅ (period week/month/all, group by client/project/task/teammate, CSV export, summary band). Profitability ✅ (static, all-time). Receivables ✅ (A/R aging, static).
- **No Expenses report**, no utilization/capacity report, no invoiced/uninvoiced report type.
- Period selector only on Time (not Profitability/Receivables); no custom date range / quarter / year; CSV only on Time; no saved reports, no per-field filters, no charts.

### Settings `/settings`
Preferences ✅ (broad), Modules ✅ (8 flags incl. `timesheetApproval`, `activityLog` — toggles with no backing UI), Invoice appearance ✅ (color/title/logo + column toggles), Expense categories ✅ (archive/restore).
- **Field-label renaming** ❌ (appearance only toggles columns; `InvoiceLabels` model 🗄️).
- No email templates / default messages ❌ · no notifications settings ❌ · no roles/permissions admin UI ❌ · no tax rates / payment-term defaults ❌ · no per-user vs company split (all writes to the one `account` row).
- Integrations ✅ (Stripe/Xero/Asana connect/disconnect, Asana import, sync log). Migrate ✅ (connect/backup/import — spec 13).

---

## Cross-cutting "schema exists, no UI" (🗄️) — quick wins to surface
- `AuditLog` → invoice/entity activity timeline + "history" views.
- `Timesheet` (+ `approved` lock, `timesheetApproval` module) → submit/approve workflow.
- `Expense.receiptFileUrl` → receipt upload + display.
- `InvoiceLabels` → field-label renaming (module/setting).
- Person `PersonBillableRate` / `PersonCostRate` → rate UI on team member.
- `activityLog` module flag → the activity log screen it implies.

---

## Recommended priority (for discussion)
Big Sea actually uses invoicing heavily, so the highest-leverage gaps are on the invoice:
1. **Edit invoice** (composer for an existing invoice + line-item editing) — foundational; unblocks blank invoices too.
2. **PDF / print** of the invoice (client-facing + internal).
3. **Invoice activity/history** (wire `AuditLog` on send/pay/view; show timeline) + **Actions ▾** consolidation (write-off, duplicate, resend, manual Xero copy).
4. **Expense edit/delete + receipt upload.**
5. **Per-project person/task rates** (needed for accurate billing at scale).
6. **Team: real email invite + rate UI.**
7. Timesheet submit/approve (only if Big Sea turns the module on).

Deferred/aligned with other specs: multi-brand routing (spec 16), notifications/email sending (needs an email provider — spec 15 groundwork).

---

# Fidelity re-audit — 2026-08-07 (current state, post invoices + team + entities)

A full second-pass audit of every screen group against the Harvest target in specs 03–12/15.
Invoices, team-member detail, and multi-brand are now **built**; this pass catalogs what remains,
separating **correctness bugs** (cheap, worth fixing regardless) from **feature gaps**.

## A. Correctness bugs / inconsistencies — quick wins
These are wrong today, not just missing. Small fixes, high trust value.

| # | Bug | Where | Note |
|---|---|---|---|
| B1 | Generated invoice line items are `taxable: false`, so header tax % silently yields **$0 tax** until each line is re-checked | `modules/invoicing/generateInvoice.ts:139` | real money bug for tax accounts |
| B2 | `generateInvoice` pulls **all** of a client's billable entries with no currency/project/date filter → mixed-currency clients sum wrong (AC-INV-018) | `modules/invoicing/generateInvoice.ts:29-48` | correctness + missing date/project entry point |
| B3 | Public invoice view never stamps `lastViewedAt` (AC-INV-016) | `app/i/[token]/page.tsx:19-31` | "viewed" signal never recorded |
| B4 | Week start hard-coded to Monday, ignores `account.weekStartsOn` | `app/timesheet/page.tsx:33`, `lib/week.ts` | wrong for Sunday-start |
| B5 | Modal "Start timer" ignores the chosen date — always logs to today | `modules/time/timer.ts:27` vs `TimeEntryModal` | back-dated timer misfiles |
| B6 | CSV export has no currency column (AC-RPT-006) | `app/reports/export/route.ts:59` | non-compliant export |
| B7 | Delete-invoice audit hard-codes "Draft deleted" even for sent invoices | `app/invoices/actions.ts` (delete) | wrong history label |
| B8 | `EditProjectForm` collapses any budget method other than hours_total/fee_total to `none` on load | `components/EditProjectForm.tsx:53-55` | silent downgrade |
| B9 | Stale dev copy "Read-only week view · scoped to a demo user until auth lands" | `app/timesheet/page.tsx:104` | now false |
| B10 | Archived projects/clients/tasks leak into list queries (no `archivedAt` filter) | `app/projects/page.tsx:39`, `app/clients/page.tsx:15` | once archive exists |

## B. Feature gaps — prioritized

**P1 — core money / data correctness**
1. **Outbound email: none exists.** "Send invoice" only flips status; all of spec 15 (E1–E7: receipts, past-due reminders, digests, timesheet-past-due, budget alerts, sign-in codes) unimplemented; no provider, no cron. Models (`InvoiceMessageTemplate`, `SenderAddress`, `InvoiceLabels`, `timesheetReminderRule`) exist but nothing reads them. **Unblocks:** invoice send/reminders, per-entity sender (spec 16), team email invites.
2. **Per-project person/task rate overrides — no UI.** `billableRateMethod` offers person/task but nothing sets `ProjectUserAssignment.hourlyRateCents` / `ProjectTaskAssignment.hourlyRateCents`; those billing modes silently fall back to defaults.
3. **Delete a recorded payment (AC-INV-011)** and **delete a sent invoice (AC-INV-013b)** — backend + state machine support both; no UI wires either (+ no confirm dialog on numbered docs).

**P2 — everyday workflows**
4. **Expense edit / delete + receipt upload + unit/mileage entry.** Create-only today; `receiptFileUrl` import-only; flat amount only (AC-EXP-002/003/006 unreachable).
5. **Timesheet submit / approve / reopen** — the whole `Timesheet` model + `timesheetApproval` module is dead code; toggling the module does nothing (off at Big Sea, so spec-compliant as default, but unbuildable-on).
6. **Client contact management** — only one contact at create; no add/edit/remove, no phone fields, no change-invoice-recipient.
7. **Archive / restore** for projects, clients, tasks (schema-ready; no action or "view archived").

**P3 — invoicing depth + configure**
8. **Invoice Configure suite** — Default values, Messages/templates, **Field-label map** (`InvoiceLabels`), Sender addresses, Item-type management: models exist, no UI.
9. **Composer**: per-line Item Type + Linked-project, online-payment toggle, currency control.
10. **Estimates**: no public `/e/[token]` route (token issued, unviewable); single-line create only; no line-item editor.
11. **Recurring**: no per-profile auto-send (always drafts).

**P4 — reports + dashboard**
12. **Reports coverage ~half**: no standalone Uninvoiced, Invoiced (days-to-pay), Payments, Expenses, or Team-utilization reports; no Saved reports. No filters, custom date ranges, or charts; CSV only on Time.
13. **Dashboard widgets**: uninvoiced / overdue / capacity-utilization + top-right quick actions.

**P5 — settings + chrome fidelity**
14. Preferences: timesheet deadline + reminder rule, account owner, number/currency format.
15. Per-user notification/unsubscribe settings; account-level tax-rate registry; roles admin / sign-in security page.
16. Appearance form under-exposes schema (banner, background, snail-mail, item-type column, company-branding toggle).
17. List chrome across screens: Actions ▾ / Import / Export / search / filters / segmented controls; invoicing tab shell + issued-per-year chart.

## C. Recommended build order
1. **Correctness bugs B1–B6** (a single cleanup pass — cheap, high trust).
2. **Email provider + core sends** (P1.1) — the biggest unlock; pair with the Configure Messages UI (P3.8).
3. **Delete payment / delete sent invoice** (P1.3).
4. **Per-project rates UI** (P1.2).
5. **Expense edit/delete + receipts** (P2.4), then **archive/restore** (P2.7) and **client contacts** (P2.6).
6. **Timesheet approval** (P2.5) only if Big Sea plans to enable the module.
7. Reports depth + dashboard widgets (P4), then remaining configure/settings/chrome (P3/P5).

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
| Notifications / emails | ❌ | no reminder/digest settings; "Send invoice" flips status but sends no actual email |

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

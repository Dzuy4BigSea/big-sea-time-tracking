# Findings — Observed from the live Big Sea Harvest account (2026-08-04)

Ground truth captured by driving `bigseadesign.harvestapp.com`. Each item corrects or extends the original memory-based spec. **These observations take precedence over the earlier spec text.** Corrections are folded into the domain files; this doc is the audit trail and the "why".

## A. Feature is modular (Settings → Modules) — reshapes scope

Harvest is a set of toggleable modules. **Big Sea's actual configuration:**

| Module | Big Sea | Build priority |
|---|---|---|
| Time tracking | ✅ On | P0 |
| Expense tracking | ✅ On | P1 (was "out of scope" — now **in**) |
| Team | ✅ On | P0 |
| Invoices | ✅ On | P0 |
| Client dashboard | ✅ On | P1 (client-facing portal — was "no portal") |
| Timesheet approval | ❌ Off | P3 (build the module, off by default) |
| Estimates | ❌ Off | P3 (not used by Big Sea) |
| Activity log (Premium) | ❌ Off | P2 (audit log still needed internally) |

**Implication:** the clone needs a **module/feature-flag layer**. For a drop-in replacement, prioritize what Big Sea actually uses; do **not** over-invest in timesheet approval or estimates (both off).

## B. Project billing is a **two-level** model (was a flat 5-value enum)

Observed on Project → Edit:

- **Level 1 — Project type:** `Time & Materials` · `Fixed Fee` · `Non-Billable`.
- **Level 2 — Billable rates** (only when *Time & Materials*): `No billable rate` · `Project billable rate` · `Person billable rate` · `Task billable rate`.
- **Fixed Fee** exposes a single **"Project fees"** amount ("the amount you plan to invoice"); budget can still be tracked in hours independently.
- **"No billable rate"** is a valid T&M state: time & internal cost are tracked, but billable amount is unknown until rates are set (the project page literally shows *"This project's billable rates were never set. Set billable rates."*).

→ Replace `Project.billingMethod` (5 values) with `Project.projectType` (3) + `Project.billableRateMethod` (4, nullable). See [01](01-data-model.md), [03](03-clients-projects-tasks.md).

## C. Rates are **effective-dated histories**, not single values (biggest correction)

Observed on Team → person → Rates:

- **Billable rate** and **Cost rate** are *separate* tables, each a list of rows: `Hourly rate × Start date × End date` with Edit/Delete and "+ New rate". The current row shows a "Current" badge; ranges read "All prior → All future".
- Visibility: **billable rates** → Admins + Managers-with-permission; **cost rates** → **Admins only**.
- Rates exist at person level (default), overridable per project. Project/task billable rates likewise.

→ A time entry's rate is resolved by matching the entry's **date** to the effective range, not by a single snapshot field. Model rates as effective-dated rows: `PersonBillableRate`, `PersonCostRate`, plus per-project overrides. See [01](01-data-model.md) §Rates, [03](03-clients-projects-tasks.md) §Rate resolution (revised).

## D. Permissions = **6 customizable profiles** (was 3 roles)

Observed on Team → person → Permissions. Profiles:

1. **Member** — track time & expenses on assigned projects.
2. **Project Manager** — manage projects/clients/tasks; view/edit team time & expenses; **no** rates/invoices/people/settings.
3. **People Admin** — manage people + all time/expenses account-wide; **no** rates/invoices/settings.
4. **Accounting** — manage invoices/estimates/expenses/clients; view rates & reports; **no** people/settings.
5. **Executive Manager** — manage time/expenses/projects/people/invoices/reports; view rates; **no** settings/billing.
6. **Administrator** — full access to everything incl. billing.

Profiles are a **starting template you then customize** ("select a different profile and customize it"). Separately, **Account Owner** is a single designated person (billing owner). Also: the person "Roles" field (Designer, Biz Dev…) is **descriptive tagging**, not permissions. See [02](02-auth-accounts.md) (revised).

## E. Invoice state machine — richer than modeled

- **Display statuses seen:** `Draft`, `Sent`, `Pending`, `Paid`, `Late` (+ `Write off`/closed). `Late` and `Pending` are surfaced as first-class badges (Late = sent + past due + unpaid; Pending appears to mean queued/awaiting).
- **Actions on a *sent* invoice:** Resend, Copy invoice link, Edit invoice, **Mark as draft**, Copy to Xero, Duplicate, **Create recurring**, **Write off invoice**, **Delete**, Record payment.
- Corrections to earlier spec: `open → draft` ("Mark as draft") **is** allowed (unlocks entries); **Delete is available on sent invoices**, not just drafts.
- Invoice line items support a **detailed** grouping: `[project code] – date – task / person: notes`.
- Invoice creation modal: choose **Client**, then **Type** = *From tracked time & expenses* or *From scratch*, then *Choose projects*.
- Per-invoice **reminders** ("email once 1 day late, every 7 days after"); invoice history / audit trail on each invoice.

See [05](05-invoicing.md) (revised).

## F. Recurring invoices & Retainers are core (heavily used)

- **Recurring**: profile with Client, Subject, frequency (e.g. every month), Next invoice date, Amount; can be **Paused**. Dozens active at Big Sea.
- **Retainers**: prepaid balance per client (or per project / "All projects"). Columns: Uninvoiced amount, **Retainer balance**; archived show **Drawn balance**. Deposit model — client prepays, work/invoices draw down. Note dashboard "total paid excludes retainer deposits".

→ New domain. See [10-recurring-retainers.md](10-recurring-retainers.md).

## G. Time tracking specifics

- Entry modal: Project/Task (pre-filled last-used), Notes, a `0:00` duration field, **Start timer**; plus **"Pull in a calendar event"** (calendar integration).
- Two modes, account-controlled by **Timer mode** preference (`Track time via duration` at Big Sea) — duration entry vs start/stop timer.
- **Day** and **Week** views. Week grid: rows = Project(Client)/Task, columns = Mon–Sun editable `h:mm` cells + row/day/week totals; **+ Add row**; "Copy from last week/most recent day (projects only)".
- Admin viewing a teammate's timesheet gets an amber banner: *"Changes will save to [name]'s timesheet."*
- **Rounding is a summary/invoice-layer concern**: *"Time is never rounded in detailed time reports and timesheets."* Store exact minutes; round only in summaries/invoices.
- **Time entry notes** can be Optional/Required (Premium) — account preference.

See [04](04-time-tracking.md) (revised).

## H. Clients, Tasks, Team specifics

- **Client** has **many contacts**; specific contacts flagged **"(invoices)"** = billing recipient. → `ClientContact` table. Client also holds address, phone.
- **Tasks** are global, split into **Common** ("automatically added to all new projects", default billable rate e.g. $160) vs **Other** ("must be manually added", often $0/internal). → `Task.autoAddToNewProjects`, `defaultBillable`, `defaultBillableRate`.
- **Team person** fields: Type (Employee/Contractor), descriptive Roles tags, Departments tags, **Capacity** (h/wk), per-person **Timezone**, Employee ID, photo. Sub-tabs: Basic info, Rates, Assigned projects, Assigned people, Permissions, Notifications, Security.
- Team list shows Utilization %, Capacity, Billable hours; role badges (Owner/Administrator/Manager…); **Assignments** tab (new).

## I. Reports families

Top-level: **Time** (group by Clients/Projects/Tasks/Teammates; billable & uninvoiced amounts; "Include Fixed Fee projects" toggle; Detailed report; Export/Print), **Profitability** (cost vs billable margin), **Activity log**, **Contractor**, **Invoicing** (sub-tabs: Invoiced / Payments received / **Receivables** / **Uninvoiced**, with a **"Paid in" days-to-payment** metric), **Saved reports**. Uninvoiced moved here from the Invoices tab. See [07](07-reporting.md) (revised).

## J. Account preferences (Settings → Preferences) — full list

Company name; **Account Owner** (single person); Timezone; **Fiscal year** start; **Start week on**; **Default capacity** (h/wk); **Timesheet deadline** (day+time); **Timesheet reminders** (rule: sent 1h before & 24h after deadline to anyone under 50% capacity); **Time entry notes** (optional/required, Premium); **Time rounding**; **Date format**; **Time format** (12/24h); **Time display** (HH:MM vs decimal); **Timer mode** (duration vs start/stop); Calendar view; **Currency**; **Currency format**; **Number format**; **Expense reimbursement** policy. See [11-settings-modules-preferences.md](11-settings-modules-preferences.md).

## K. Integrations observed (out of scope to build, but present)

Xero (invoice sync — "Copy to Xero", "View on Xero"), Stripe (online payments: ACH + Credit Card, optional pass-through fees), Google (import team, calendar events), Forecast (scheduling/capacity — separate product). E-invoicing UBL export toggle. Keep a generic integration seam; don't build these in phase 1.

## L. Second deep-dive (now captured) & remaining gaps

Captured in the second pass (folded into [12-ui-fidelity.md](12-ui-fidelity.md)): **invoice composer/edit**, draft vs sent **invoice detail**, **Home dashboard**, **Integrations** marketplace, **Sign-in security** (+ central Harvest ID identity), **Profitability** (Premium concept), invoice **Configure** sub-pages incl. **Item types** and **Messages** (email templates + sender addresses).

New model additions from this pass: **ItemType** (configurable line-item revenue categories; `Service`/`Product` system defaults), **InvoiceMessageTemplate** (invoice/reminder/thank-you emails with variables), **SenderAddress**, and a central **Identity/Harvest ID** separate from account membership. See [01](01-data-model.md), [02](02-auth-accounts.md), [05](05-invoicing.md).

Still not captured (minor): **Client dashboard** portal (needs a client login), **Activity log** (Premium/off), **Appearance**/**Field labels** config sub-pages, and the create-forms (inferred from edit forms). Listed in [12 §Not yet captured](12-ui-fidelity.md).

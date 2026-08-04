# 12 — UI Fidelity Catalogue

Goal: a **spitting image** of Harvest for a low-friction migration. This documents observed layout, controls, and copy per screen (captured 2026-08-04 from the live account). Pair with screenshots in review. Items marked *not yet captured* need a second pass before pixel-level build.

## Global chrome

- **Left sidebar** (persistent), grouped with small caps section labels:
  - **(top)** orange **Timer** pill button · quick-timer clock icon · notes icon · "…" overflow.
  - **Track:** Home · Timesheet · Expenses
  - **Organize:** Team · Clients · Projects · Tasks
  - **Bill:** Invoices
  - **Review:** Reports
  - **(bottom):** Integrations · Settings · What's new (badge) · user avatar + name/account.
- Harvest logo top-left. Orange (`#fb5c31`-ish) is the primary accent; green (`#3aa76d`-ish) for primary confirm buttons; neutral grays for secondary.
- Content area: page title top-left, primary action button(s) top-right (green "+ New …"), a search field, and an "Actions ▾" menu where bulk actions apply.
- Typography: clean sans; generous whitespace; tables are borderless with light row separators.

## Screens captured

### Timesheet (`/time`) — [04](04-time-tracking.md)
- Top-right: **Day / Week** segmented toggle · **Teammates ▾** (searchable people list; admins can view/edit others with an amber "Changes will save to [name]'s timesheet" banner).
- Green **+** opens **New time entry** modal: Project/Task dropdowns (pre-filled last-used) · Notes · `0:00` duration field · **Start timer** · Cancel · "Pull in a calendar event".
- **Day view:** date navigator (← Today [date] →), Mon–Sun total strip with per-day + Week total, entry list, "Copy from the most recent day (projects only)".
- **Week view:** grid — rows = Project (Client)/Task with notes icon; columns = Mon–Sun editable `h:mm` cells; row totals, per-day totals, week total; **+ Add row**; "Copy from last week (projects only)"; **×** removes a row. Empty state shows a rotating quote.

### Projects (`/projects`) — [03](03-clients-projects-tasks.md)
- Header: **+ New project** · Actions ▾ · Import · Export · search. Filter by client / by manager. "Active projects (N) ▾".
- Table grouped by client: Project name + type badge (Time & Materials / Non-Billable) · Budget · Scheduled (Forecast) · Delta · Spent (with progress bar) · Remaining (%) · Costs · Actions.
- **Project detail:** title + type badge + start date + notes ("Show more") · Edit project · Actions ▾ · progress chart (Monthly progress / Hours per week) · stat cards: Total hours (billable/non-billable) · Budget remaining (%) · Internal costs (Time/Expenses) · Invoiced amount · Uninvoiced amount (or "billable rates were never set. Set billable rates"). Tabs: Tasks · Team · Invoices.
- **Project edit:** Client (locked if linked invoices) · name · code · dates · Billing currency ("Same as client — USD"; note "Costs always use your account currency") · Notes · Permissions (report visibility) · **Project type** segmented control (Time & Materials / Fixed Fee / Non-Billable) → reveals **Billable rates** dropdown (No/Project/Person/Task) or **Project fees $** · **Budget** dropdown (Total project hours / …) + "Budget resets every month" + "Send email alerts if project exceeds N%" · **Tasks** list with Billable checkboxes · Update / Cancel.

### Clients (`/clients`) — [03](03-clients-projects-tasks.md)
- **+ New client** · Actions ▾ · Import/Export · filter. Each client is a card: Edit · name · **+ Add contact**; contacts listed with Edit, name, email/phone, and "(invoices)" tag on the billing recipient.

### Tasks (`/tasks`) — [03](03-clients-projects-tasks.md)
- **+ New task** · Export · View archived. Two sections: **Common tasks** ("automatically added to all new projects", Default billable rate col) and **Other tasks** ("must be manually added"). Each: checkbox · name · Billable badge · Default billable rate · Actions ▾.

### Team (`/team`) — [02](02-auth-accounts.md)
- Tabs: **Members** · **Assignments** (new). Header: Import from Google · Invite person · Actions · Import · Export · View archived people. Week navigator. Summary: Total hours · Team capacity · Billable/Non-billable bar.
- List: avatar · name · role badge (Owner/Administrator/Manager…) · Hours (bar) · Utilization % · Capacity · Billable hours · Actions ▾ (Edit/Pin/Archive/Delete).
- **Person edit** sub-nav: Basic info · Rates · Assigned projects · Assigned people · Permissions · Notifications · Security.
  - *Basic info:* First/Last · Work email (from Harvest ID) · Employee ID · **Type** (Employee/Contractor) · **Roles** tags · Departments · **Capacity** h/wk · Rates link · Timezone · Photo · "Use the new look".
  - *Rates:* **Billable rates** table (Hourly rate · Start date · End date · Edit/Delete, "Current" badge) + "+ New billable rate"; **Cost rates** table likewise. Visibility notes per role.
  - *Permissions:* the 6 profiles as radio options with descriptions; "Only another Administrator can edit your permissions."

### Invoices (`/invoices`) — [05](05-invoicing.md)
- Tabs: **Overview · Recurring · Retainers · Uninvoiced (→ Reports) · Configure**. **+ New invoice** · search · Actions ▾.
- Overview: **Total open** · **Total paid amount** (excl. retainer deposits) · bar chart "Invoices issued in [year]" (Open/Paid). Sub-tabs **Open (N) / All invoices**. Filters: client, time range, Columns ▾. Table: Status badge (Sent/Draft/Pending/Late) · Due in · Issue date · ID · Client + subject · Balance.
- **New invoice modal:** Client (or + New client) · Type (From tracked time & expenses / From scratch) · Choose projects / Cancel.
- **Invoice detail:** "Invoice NNN" + status badge + integration link · latest activity · reminder line ("Edit reminder") · linked project · action bar (Resend · Copy invoice link · Edit invoice · Actions ▾ · Balance · Record payment) · the rendered invoice (logo, From/Invoice For, ID/Issue/Due, Subject, line items, Amount Due, Notes/Terms, Attach file) with a status watermark · **Invoice history** below. Actions ▾: Mark as draft · Copy to Xero · Duplicate · Create recurring · Write off · Delete.
- **Recurring:** Client · Invoice subject · Next invoice (date + "every month" / **Paused**) · Amount. **+ New recurring invoice**.
- **Retainers:** Ongoing (Client · Project · Uninvoiced amount · Retainer balance) + Archived (Drawn balance). **+ New retainer**.
- **Configure** sub-nav: Company information (name, address, E-invoicing UBL toggle) · **Default values** (Time rounding, Show total hours, Payments due, Invoice subject, Invoice notes, Online payments ACH/Credit Card, fee pass-through) · Appearance (colors/banner) · Messages (portal URL, email sender) · Field labels · Item types.

### Expenses (`/expenses`) — [09](09-expenses.md)
- Tabs: All expenses · Categories. **+ Track expenses** · Teammates ▾. Weekly groups; rows: date · Project (Client) · Category · Billable badge · notes · amount · receipt paperclip · lock icon.

### Reports (`/reports`) — [07](07-reporting.md)
- Tabs: **Time · Profitability · Activity log · Contractor · Invoicing · Saved reports**. **+ New report ▾**.
- Time: period selector + navigator · summary (Total hours · billable donut · Billable amount · Uninvoiced amount + "Include Fixed Fee projects") · group-by sub-tabs (Clients/Projects/Tasks/Teammates) · table (Name · Hours bar · Billable hours % · Billable amount) · "Active projects only" · Detailed report · Export · Print.
- Invoicing: sub-tabs Invoiced / Payments received / Receivables / Uninvoiced; Invoiced table adds **Paid in** (days-to-payment).

### Home / Dashboard (`/overview`)
- Title "Dashboard"; top-right quick actions: **Track time · Track expenses · New invoice**.
- **Time summary** card: Hours today / yesterday / this week / last week / this month / last month; links "View team hours" / "View my hours".
- **Invoice summary** card: Amount outstanding (N invoices, red) · Amount invoiced this month (red) · Payments received last month · Payments received year-to-date.
- **Recently active projects** table: Project (client + name) · Budget · Spent (bar) · Remaining (%). "View projects report".

### Invoice composer / edit (`/invoices/:id/edit`) — [05](05-invoicing.md)
- Two-column header: **Invoice ID** (editable) · PO Number · Issue Date · Due Date (Net-term dropdown) | Invoice For (client, locked) · **Tax** (Apply tax from Xero) · **Discount %** · **Currency**. Subject full width.
- **Line-item table:** columns **Item Type** (configurable dropdown) · Description (multi-line) · **Quantity** · **Unit Price** · **Amount** · × remove; per-line **Linked project** dropdown (+ "?" help). **+ Add item**. Right rail: Subtotal · **Total hours** checkbox · Amount Due.
- **Notes** (markdown-ish: *bold* _italics_) with formatting tips.
- **Accept online payments** toggle → Credit Card (Instant, ~2.9%+$0.30) / ACH (3–5 days, ~0.8%); "Pass fees on to client (New)" + compliance box.
- **Update invoice / Cancel**. (Even fixed-fee invoices are expressed as qty × unit price.)

### Invoice detail — draft vs sent (`/invoices/:id`)
- Draft: **Send invoice** (green) · Copy invoice link · Edit invoice · Actions ▾ · Balance · Record payment; **DRAFT** watermark; "Edit info" inline on client block; Preview / PDF / Print.
- The rendered document is the client-facing artifact (logo, From, Invoice For, ID/Issue/Due, Subject, line items, Amount Due, Notes/Terms, Attach file). **Invoice history** below.

### Invoice Configure sub-pages (`/invoices/configure/*`) — [05](05-invoicing.md), [11](11-settings-modules-preferences.md)
- **Company information:** Name · Address · E-invoicing (UBL export).
- **Default values:** Time rounding · Show total hours · Payments due · Invoice subject · Invoice notes · Online payments (ACH/Credit Card) · pass-through fees.
- **Appearance:** invoice colors, banner/logo (not screenshotted — generic).
- **Messages:** **Send messages as** (multiple sender addresses, Make default/Delete, + Add custom email) · **Edit invoice content** with variables and three tabs: **Invoice message / Reminder message / Thank you message** (Subject + Body, e.g. `%invoice_client%`, `%invoice_url%`).
- **Field labels:** rename invoice field labels (generic).
- **Item types:** list of configurable revenue categories with Edit/Delete; **+ New item type**; `Service` (default for billable hours/fees) and `Product` (default for expenses) are undeletable system defaults.

### Integrations (`/company/settings/integrations`)
- Filter + search; categorized cards (**Project management** — Asana, Forecast [Featured], Basecamp, ClickUp, GitHub, Jira, Linear, Monday, Notion, Trello; **Finance and payments** — Xero, Stripe, etc.). Most PM tools connect via a **Harvest browser extension** that injects a timer button. Cards have Connect / Get the extension / View settings.

### Reports → Profitability (`/reports/profitability`) — Premium
- Premium (upsell for Big Sea). Concept: profit-over-time chart + **Revenue** (Invoiced + Uninvoiced) vs **Cost** (Total time + Expenses) per project/client/task.

### Settings (`/company/...`) — [11](11-settings-modules-preferences.md)
- Sub-nav: Billing · Preferences · Modules · Sign in security · Import/Export · Bulk actions. (Preferences and Modules field lists in [11](11-settings-modules-preferences.md).)
- **Billing:** current plan + seats, payment method, receipt recipients, web address (subdomain), account-created date.
- **Sign in security:** Require 2FA · Require sign in with Google · SAML SSO (Premium); note that password/session/personal-2FA live in the central **Harvest ID**.

## Not yet captured (minor — for final pixel polish)

- **Client dashboard** (client-login portal) — needs a client account to view; specced from the public-link invoice document for now.
- **Activity log** report detail — Premium & disabled at Big Sea.
- **Appearance** and **Field labels** config sub-pages — described generically above; screenshot before pixel-matching invoice branding.
- **Create** forms (New project/client/task/person) — inferred from the corresponding edit forms, which are captured.
- **Import/Export** and **Bulk actions** settings detail — see [13-migration.md](13-migration.md).

## Fidelity acceptance criteria

- **AC-UI-001** — *Given* each screen above, *when* the clone renders it, *then* nav placement, primary/secondary actions, column sets, badges, and empty-state copy match the catalogue.
- **AC-UI-002** — *Given* the left sidebar, *when* a module is disabled, *then* its nav item is hidden (e.g. no Estimates link at Big Sea).
- **AC-UI-003** — *Given* the color system, *when* primary confirm / accent / status badges render, *then* they match Harvest's palette (orange accent, green confirm, status colors: grey Draft, blue Sent, teal Pending, green Paid, red Late).

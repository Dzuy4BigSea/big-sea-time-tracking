# 26 — Expenses parity: Reports → Expense reports (screen 7) and Expenses (screen 10)

Harvest parity for the two expense screens listed in [24](24-harvest-ui-capture.md) (screens 7 and 10).
Source: Harvest Help Center via the Harvest connector, plus read-only API reads of Big Sea's account
(2026-10-13). Nobody has seen these screens in a signed-in browser yet, so layout details the help center
doesn't cover are marked **UNVERIFIED — confirm in Harvest**. Re-run capture prompt items 7 and 10 to close them.
Extends [09-expenses](09-expenses.md) (AC-EXP-001…006) and [25](25-detailed-and-saved-reports.md) (detailed reports).

## Big Sea account facts (Harvest API, read-only)
- `expense_feature: true`, `approval_required: false`, `week_start_day: Monday`.
- 16 active categories. Two are unit-based: **Mileage** (`miles`, $0.55) and **SSL Certificate** (`year`, $65.00). The rest are flat amounts (Assets, Design Contractor, Development Contractor, Email service subscription, Entertainment, Hosting, Lodging, Meals, Media Buy, Other, Printing, Travel Expense, WordPress Development, WP Premium Plugin).
- Each expense row has: `spent_at`, project, category, user, `total_cost`, `units` (1.0 for flat categories), `notes`, `billable`, `has_receipt`, `is_invoiced`, `currency_code` (the client's currency).
- In practice, markup is typed into the notes ("Includes service markup"). Harvest has no per-expense markup field. Track2's `markupPercent` is a Track2 extra (09).

## 7. Reports → Expense reports

### Harvest behavior
- Harvest has no summary "Expenses" tab. The Reports tabs are Time | Profitability | Contractor | Invoicing | Saved reports (24 §6). The expense report is **Reports → + New report → Detailed expense**. Expenses also appear in Reports → Uninvoiced and in the project analysis "Internal costs". https://support.getharvest.com/hc/en-us/articles/360054457791
  - Track2 keeps its summary **Reports → Expenses** tab as a Track2 extra, shaped like the Time report: a summary card plus group-by tabs. Harvest's own UI never shows this tab (UNVERIFIED that no hidden equivalent exists).
- **Builder:** Timeframe; Clients; Projects; **Expense categories**; Team (or "Search roles" → Roles); "Include archived items in filters" checkbox; **Run report**. A blank field means "All …", archived items included. https://support.getharvest.com/hc/en-us/articles/360048687171
- **Toolbar:**
  - Header: "Change filters" (top right).
  - **Show** menu: invoiced / uninvoiced, billable / non-billable.
  - **Group by** menu.
  - **Active projects only** checkbox.
  - **Export ⌄**: Excel / CSV / PDF / Custom. The PDF includes the receipt images and arrives as an emailed download link.
  - Print icon and Save report.
  - https://support.getharvest.com/hc/en-us/articles/360048181592
- **Receipts:** Administrators and Managers see a 📎 paper clip next to the number in the **amount column**. Clicking it views or prints the attached file.
- **Bulk actions (Administrators only):** row checkboxes plus an **Actions** menu. Options: "Mark all/selected expenses as invoiced / uninvoiced". Managers can never use bulk actions. https://support.getharvest.com/hc/en-us/articles/4408204890381 · https://support.getharvest.com/hc/en-us/articles/30704133376269
- **Permissions:** Members see only their own expenses. Managers see their own, plus expenses on projects they manage, plus expenses of their assigned people. Administrators see everyone. https://support.getharvest.com/hc/en-us/articles/14820451322125
- Group-by options for expenses: Date / Client / Project / Category / Teammate. The Date default and the column order (Date, Client, Project, Category, Person, Amount) are **UNVERIFIED — confirm in Harvest**.
- Timeframe options follow 25 (This/Last week … year, All time, Custom).

### Acceptance criteria
- **AC-EXP-101** — *Given* a Member with expenses and a teammate's expenses in the period, *when* they open Reports → Expenses, *then* only their own expenses are counted (tiles and every grouping).
- **AC-EXP-102** — *Given* an Administrator (`run_account_reports`), *when* they open Reports → Expenses, *then* every expense in the account for the period is counted.
- **AC-EXP-103** — *Given* the Expenses report, *when* the user picks a group-by tab, *then* the tabs are Clients | Projects | Categories | Team. The URL is `?tab=clients|projects|categories|team` (default Clients) and the timeframe is kept.
- **AC-EXP-104** — *Given* a grouping row, *when* the name or the amount is clicked, *then* the Detailed expense report opens. It carries the same timeframe and is filtered to that client / project / category / person.
- **AC-EXP-105** — *Given* a period with billable expenses carrying markup, *then* the summary card shows Total amount, Billable (with markup) and Non-billable. Uninvoiced = billable and not invoiced. All values are integer cents (INV-1).
- **AC-EXP-106** — The summary report aggregates in Postgres (GROUP BY) and never loads every expense row into memory.
- **AC-EXP-107** — *Given* the Detailed expense report and an expense with a receipt, *when* an Administrator or Manager views it, *then* a 📎 link next to the amount opens the receipt. Members see their own receipt links too (UNVERIFIED whether Harvest shows members the clip).
- **AC-EXP-108** — *Given* a Manager (scoped `run_account_reports` or a PM), *when* they run the Detailed expense report, *then* the report includes their own expenses, expenses on projects they manage, and expenses of their assigned people.

## 10. Expenses (Track expenses form + list)

### Harvest behavior
- **Page:** Expenses (Timesheets → Expenses).
  - Green **Track expenses** button. It opens an orange **New expense** box.
  - **Teammates** button top right, for Administrators and Managers with permission to edit others' expenses.
  - https://support.getharvest.com/hc/en-us/articles/360048687611 · https://support.getharvest.com/hc/en-us/articles/4406054281101
- **New expense fields, in this order:**
  - **Date**.
  - **Project**: only active projects you're assigned to. "If you do not see the project… ask an Administrator to assign you".
  - **Category**: active categories only. Archived categories can't be tracked to.
  - **Amount**: money for a flat category, or a **quantity** for a unit-price category (e.g. "2 miles"). Harvest computes the total from the unit price.
  - **Notes** (optional, e.g. vendor).
  - **Attach receipt** link, or drag-and-drop onto the orange box. Accepts .png/.gif/.pdf/.jpg/.jpeg.
  - **This expense is billable** checkbox.
  - **Save expense**.
  - https://support.getharvest.com/hc/en-us/articles/360048687111
- **Billable default:** expenses on billable projects default to billable; on non-billable projects they default to non-billable. Non-billable expenses can't be invoiced and are excluded from uninvoiced amounts.
- **Currency:** the expense currency is the project client's preferred currency.
- **List:**
  - It is your own expenses, organised by **week**. When timesheet approval is on, there is a "Submit for approval" link per week; time and expenses are submitted together. https://support.getharvest.com/hc/en-us/articles/360048687111
  - Each row has **Edit** on the right. A **lock icon** replaces Edit when the expense is locked.
  - Mobile: moving between weeks with arrows; web: week sections. Whether the web list shows several weeks with older-weeks paging, and the exact per-row layout, are **UNVERIFIED — confirm in Harvest**. 09 (observed) lists date · Project [code] (Client) · Category · Billable badge · notes · amount · receipt clip · lock, plus a weekly subtotal.
- **Edit:** **Update expense**, or **Delete** (with confirm). There is no lock while unlocked. https://support.getharvest.com/hc/en-us/articles/4406054281101
- **Locking:**
  - An expense locks when it is invoiced or approved, or when its project, person, client or category is archived.
  - On a locked entry, Administrators can edit only **Notes and Amount**, or delete it (via the lock icon). Managers and Members can't edit locked expenses.
- **Teammates:** you can track and edit expenses for another person (Administrators, plus Managers for their managed people/projects).
- **Categories:**
  - Managed under Manage → Expense categories (Admins only). Managers never see them.
  - Actions: New category ("This expense has a unit price" → price + unit name), Edit, Archive, Restore ("View archived categories"), Delete (only when unused).
  - A unit-price change applies to future entries only; re-saving an old expense re-prices it. https://support.getharvest.com/hc/en-us/articles/360048686731
- **Reimbursement** (new, rolling out): this is a Stripe payout flow. Big Sea has it disabled (findings). Out of scope.

### Acceptance criteria
- **AC-EXP-110** — *Given* a Member, *when* they open Expenses, *then* they see only their own expenses. Never a teammate's (INV-5 + permissions).
- **AC-EXP-111** — *Given* expenses across several weeks, *then* the list is grouped into weeks, newest first. Weeks start per the account preference. Each week header shows the range ("12 – 18 Oct 2026") and the week's total.
- **AC-EXP-112** — *Given* more expenses than one page holds (50), *then* the page ends on a whole week and an "Older expenses" link continues from the next older week. Week totals are never split across pages, and no query loads the full expense table.
- **AC-EXP-113** — *Given* an actor with `view_edit_others_time`, *then* a **Teammates** switcher lists the people they may act for. `?user=<id>` shows that person's expenses, plus a banner "Changes will save to {name}'s expenses." with a link back. A PM is limited to managed people; the server re-checks every request.
- **AC-EXP-114** — *Given* the Track expenses form, *then* the Project picker lists only active projects (of active clients) that the subject person is assigned to, grouped by client. The server rejects any other project.
- **AC-EXP-115** — *Given* a non-billable project (`isBillable=false` or type `non_billable`) is picked, *then* "This expense is billable" unchecks. A billable project checks it. The user can still override.
- **AC-EXP-116** — *Given* a unit-based category (Mileage $0.55/miles) and a quantity of 100, *when* saved, *then* `totalCents = 5500` and the form previews "100 miles × $0.55 = $55.00". Flat categories take a money amount. (Extends AC-EXP-002.)
- **AC-EXP-117** — *Given* an archived category, *then* it isn't offered on the new form. The server rejects it for a new expense, but an existing expense on it stays editable.
- **AC-EXP-118** — *Given* an invoiced expense, *then* the row shows 🔒 instead of Edit/Delete (AC-EXP-003). The server rejects edit and delete.
- **AC-EXP-119** — Labels: green "+ Track expenses" button; form heading "New expense"; checkbox "This expense is billable"; submit "Save expense". The edit form submits with "Update expense".

## GAP table (vs Track2 at 21b8372 + BugHerd #15)

| # | Gap | Track2 today | Priority | Status |
|---|---|---|---|---|
| G1 | Expenses list shows **every** account expense to everyone and loads all rows (`findMany` without a bound) | [app/expenses/page.tsx](../app/expenses/page.tsx) | **P0** (permission leak + perf rule) | Built: own/teammate scope, week groups, paged (AC-EXP-110…112) |
| G2 | Reports → Expenses counts all account expenses for any user and aggregates in JS | [app/reports/expenses/page.tsx](../app/reports/expenses/page.tsx) | **P0** (permission leak) | Built: scope + SQL GROUP BY (AC-EXP-101,102,106) |
| G3 | No Teammates switcher on Expenses; create is always for self | page + [app/expenses/actions.ts](../app/expenses/actions.ts) | P1 | Built (AC-EXP-113) |
| G4 | Project picker offers every active project, not the person's assignments; no server check | page + actions | P1 | Built (AC-EXP-114) |
| G5 | Unit-based categories (Mileage, SSL) are not supported on the form; the user must type the total | [components/NewExpenseForm.tsx](../components/NewExpenseForm.tsx), [EditExpenseForm](../components/EditExpenseForm.tsx) | P1 | Built (AC-EXP-116) |
| G6 | Billable doesn't default from the project | NewExpenseForm | P1 | Built (AC-EXP-115) |
| G7 | Archived category accepted by the server on create | actions | P1 | Built (AC-EXP-117) |
| G8 | Summary report has only By category / By client; no Projects / Team tabs, no drill-down to detailed | reports/expenses | P1 | Built (AC-EXP-103,104) |
| G9 | Labels differ ("+ New expense", "Add expense", "Billable") | forms | P2 | Built (AC-EXP-119) |
| G10 | Detailed expense report has no receipt 📎 in the amount column | [app/reports/detailed/expenses/page.tsx](../app/reports/detailed/expenses/page.tsx) | P2 | Built (AC-EXP-107) |
| G11 | Detailed expense: Managers see only their own (no managed projects / assigned people) | [modules/reports/detailedSql.ts](../modules/reports/detailedSql.ts) `DetailedScope` | P2 | Open (AC-EXP-108). Shared with detailed time, so it needs coordinating with that owner |
| G12 | Receipts are a URL field, not a file upload (png/gif/pdf/jpg, drag-drop) | forms | P2 | Open: needs storage (Supabase Storage / Vercel Blob) |
| G13 | Admin "Mark invoiced / uninvoiced" bulk actions on Detailed expense | none | P2 | Open |
| G14 | Locked-by-archive (project, person, category) and Admin editing Notes/Amount on a locked expense | expenseGuard locks only on invoiced | P3 | Open |
| G15 | Expense `units` aren't stored (the quantity is derived from total ÷ the category's current unit price on edit; history is wrong if the price changed) | schema | P3 | Open: would need an `Expense.units Decimal?` column + importer mapping |
| G16 | Detailed expense Export menu (Excel / PDF with receipts / Custom) | CSV only | P3 | Open: owned by the export/Drive work, not touched here |
| G17 | Weekly "Submit for approval" link (approval off at Big Sea) | none | P3 | Open |
| G18 | Expense currency = client currency shown on rows | rows show account currency | P3 | Open |

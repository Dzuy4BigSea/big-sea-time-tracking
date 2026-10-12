# 23 — BugHerd feedback round 1 (Chasity, 2026-09-28)

Source: BugHerd project [Track 2 (541260)](https://www.bugherd.com/projects/541260/kanban), 21 tasks
reported by Chasity Scoggins. Ingested from the BugHerd assignment email, because bugherd.com isn't
reachable from cloud sessions. Task text in the email is truncated, so items marked
**needs input** were left alone.

Fixed on branch `claude/quirky-galileo-23agcn` (2026-10-12). None of it has been tried against real
data or in a browser yet; each needs a click-through on a preview deploy.

## Done

| # | Where | Ask | What changed |
|---|---|---|---|
| 1 | /timesheet | Time-entry project dropdown should list only active projects | Timesheet modal + top-bar Timer/Track time list only active projects of active clients (active tasks too). `logTimeAction`/`startTimerAction` reject archived or unassigned projects server-side. |
| 2 | /timesheet | Certain roles should track/edit time for other people | "Timesheet for" switcher (`?user=`) for `view_edit_others_time`. Admin / exec / people admin: everyone active. Project managers: people on projects they manage. Log/edit/delete re-authorized server-side; lock guards (INV-3) apply. Timers stay personal. |
| 3 | /clients | Add and edit individual contacts per client | Client page: inline edit per contact, plus title and mobile fields. One `saveContactAction` (add/edit), gated on `manage_clients`. |
| 6 | /projects/[id] | Timeframes: Week, Month, Quarter, Year, All time, Custom | Timeframe bar drives the hours card, Tasks, Team, Invoices tabs and the task CSV. Default: Month for monthly-reset budgets, otherwise All time. Old `?month=&year=` links still work. |
| 8 | /projects/[id]?tab=team | Team tab should show time tracked, not editing | Team tab is read-only hours (billable / non-billable / amount) for the timeframe. Add/remove/PM/rates moved to the Edit page (`ProjectTeamManager`), with a "Manage team" link. |
| 9 | /reports | Sort by header fields | Clickable headers (`?sort=&dir=`) on Time (all groupings), Expenses, Profitability, Receivables. |
| 11 | /reports/expenses | Timeframe picker on all reports | Shared Week/Month/Quarter/Year/All time/Custom picker on Time, Expenses, Profitability, carried across tabs and into the CSV exports. Receivables stays "as of today" (aging). |
| 13 | /recurring | Number of invoices to issue (blank = indefinite) | `RecurringInvoiceProfile.remainingOccurrences` (nullable). Counts down per generated invoice and pauses at 0 (shown as "Completed"). Set on create or edit per row. **Needs `prisma migrate deploy` before deploy.** |
| 14 | /invoices/[id] | Big status notation front and center | Color-coded status banner: Draft / due in N days / Overdue by N days / Partially paid / Paid on date / Written off / Closed (`modules/invoicing/statusBanner.ts`). |
| 16 | /expenses | Project list sectioned by client (like Harvest) | Expense form's project picker is grouped by client. |
| 17 | /expenses | Type into a field to filter the list | New `Combobox` (type-to-filter, grouped, keyboard) on expense Project and Category. |
| 18 | /team | Close one when another is opened | Row Actions menus are single-open and close on outside click or Escape (`DropdownMenu`). |
| 19 | /team/[id]?tab=projects | Show active projects, with a selector for archived | Active / Archived / All pills, defaulting to Active. "Add a project" only offers active projects. |
| 20 | /team/[id]?tab=people | Show only active team members | Same pills, defaulting to Active. |
| 21 | /team | Live filtering without "Apply" | Filters apply on change (search debounced). `LiveFilters` is reusable. |

## Needs input (not started)

| # | Where | Ask (truncated in source) | Question |
|---|---|---|---|
| 4, 10 | Project tasks CSV, Reports | Export to Google Drive | Needs a Google OAuth integration. Is "save CSV to a chosen Drive folder" enough, or should it create a Google Sheet? Whose Drive? |
| 5 | /projects/[id] | "What is this? Just something that is part of the development phase?" | Which element? Needs the BugHerd pin/screenshot. |
| 7 | /projects/[id] | "Not a fan of this section displaying here… someone accidentally clickin…" | Which section? Probably a destructive control on the detail page; needs the pin. |
| 12 | /reports/expenses | "By Category could maybe be useful… incredibly rarely used" | Remove it, move it below By client, or leave it? |
| 15 | /expenses | "What's over here?" | Which element? Needs the pin. |

## Follow-ups noticed while fixing
- Two timeframe helpers now exist (`modules/reports/timeframe.ts`, `modules/projects/timeframe.ts`). Merge them into one.
- The time CSV export (`app/reports/export/route.ts`) still `findMany`s matching entries. It is bounded by the timeframe now, but "All time" loads the whole table. Stream it or chunk it.
- Other row-action menus (/projects, /clients, invoice detail) could adopt `DropdownMenu` for the same single-open behavior as #18.
- The time-entry modal's project/task pickers could adopt `Combobox` (#17 behavior on the timesheet).

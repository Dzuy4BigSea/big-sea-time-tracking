# 25 — Detailed reports, saved reports, "+ New report"

Captured from Big Sea's Harvest account on 2026-10-13. The team uses saved and detailed reports heavily.

## Harvest behaviour (captured)

**"+ New report ⌄"** (green, top right of every Reports screen) → **Custom report** (opens the summary Time
report, which has a "Save report" button) · **Detailed time** · **Detailed expense**.

**Detailed time builder** (`/reports/detailed/filter`), peach panel:
- Timeframe select: This week, Last week, This semimonth, Last semimonth, This month (October),
  Last month (September), This quarter, Last quarter, This year, Last year, All time, Custom.
- "Include archived items in filters" checkbox.
- Clients / Projects / Tasks / Teammates: multi-select type-ahead ("All clients", "All projects",
  "All tasks", "Everyone"); "Search roles" link. Green "Run report".

**Detailed time results** (`/reports/detailed?group=dates&start_date=…&end_date=…`):
- H1 "Detailed time report: 10/12/2026 – 10/18/2026"; right: "Save report", "Show filters" (re-opens the
  builder inline with "Update report" / "Cancel").
- Summary card: Total hours 60.68, "31.01 Uninvoiced billable hours"; right: Clients / Projects / Tasks /
  Tags / Team with the chosen filter ("All clients", "Everyone").
- Toolbar: "Show: Billable · Non-Billable ⌄", "Show: Invoiced · Non-Invoiced ⌄", "Group by: Date ⌄"
  (Client / Project / Task / Teammate / Date), "Active projects only"; right "Actions ⌄" (Mark all hours as
  invoiced / uninvoiced, Move all hours to another project / task), "Export ⌄" (Excel, CSV, PDF, Google
  Drive, Custom), print.
- Table: [checkbox] Client | Project (notes underneath, small) | Task | Roles | Person | Hours (link).
  Group header rows (e.g. the date) carry the group's hour subtotal.

**Detailed expense** (`/reports/expenses`): same builder with Categories instead of Tasks, plus a
"Reimbursable" option.

**Save report dialog:** Report name; Permissions: "Don't share this report" (default) / "Share with team"
("What will people see?"); "Save report" / "Cancel".

**Saved reports tab** (`/reports/saved`): filter "All saved reports (n)" ⌄ → All / My reports / Reports
shared with me / Archived reports. Columns: Report name | Type (Time, …) | Date saved (default sort) |
Created by (avatar) | Export format | Shared with; row "Actions ⌄" → Edit / Duplicate / Delete.
Opening one loads the report with its saved settings and a report-name menu at the right of the toolbar:
Edit / Update existing report (enabled after a change) / Save as new report.

## Track2 build (this pass)

- `SavedReport` table: name, kind (`time_summary` | `detailed_time` | `detailed_expense`), `params` (the
  report's URL query, so relative timeframes like "This week" keep rolling forward), `shared`,
  `archivedAt`, creator. Visible to the creator, or to everyone in the account when shared; editable by
  the creator or an administrator.
- `/reports/detailed` (time) and `/reports/detailed/expenses`: builder + results on one page, filters in
  the URL, group subtotals and totals computed in the DB (388k rows: never load them all), at most 2,000
  rows rendered with a pointer to the CSV export for the rest. Members without `run_account_reports` see
  only their own entries.
- "+ New report" menu and a "Saved reports" tab on every Reports screen; "Save report" on the Time report
  and both detailed reports; saved-report menu (Edit / Update existing / Save as new).
- Time report Hours cells link to the detailed report filtered to that row.

**Not in this pass:** bulk Actions (mark invoiced / move hours, which write data), Excel / PDF / Google
Drive export, Roles and Tags filters, "Reimbursable", migrating Harvest's existing saved reports (Harvest's
API has no saved-reports endpoint, so people re-save theirs).

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
- The time CSV export (`app/reports/export/route.ts`) still `findMany`s matching entries. It is bounded by the timeframe now, but "All time" loads the whole table. Stream it or chunk it.
- Other row-action menus (/projects, /clients, invoice detail) could adopt `DropdownMenu` for the same single-open behavior as #18.
- The time-entry modal's project/task pickers could adopt `Combobox` (#17 behavior on the timesheet).

## Harvest parity pass (2026-10-12)
Goal: match Harvest's UI and behavior, not invent new behavior. Reference is Harvest's help center plus
[findings](findings.md); screen-layout details wait on UI notes captured from the live Harvest account.

- **#2:**
  - "Teammates ▾" button (top right, searchable list) replaces the "Timesheet for" dropdown.
  - Amber banner reads "Changes will save to {name}'s timesheet." with a "Resume editing your own timesheet" link.
  - Admins and managers can start and stop timers for a teammate (Harvest allows it).
- **#1 / timesheet:** project and task pickers are grouped by client with type-to-filter, as in Harvest.
- **#14:** the banner headline uses Harvest's status words (Draft / Sent / Late / Paid / Written off) and
  colors (AC-UI-003). A partly paid invoice stays Sent or Late; there is no separate "partial" status.
- **#6 / #11:**
  - Harvest's **Semimonth** period (1st–15th, 16th–end).
  - One shared timeframe module (`modules/shared/timeframe.ts`) and picker for Reports and the project page.
- **#8:** Tasks and Team tables on the project page have sortable headers, as in Harvest.

**Still diverging from Harvest; decisions needed:**
- **Manager scope:** Harvest managers act for people on projects they manage *and* for their
  **assigned people** (a manager→people assignment). Track2 has no assigned-people model yet; the
  person page's "Assigned people" tab (#20) lists teammates who share a project instead.
- **Project page default timeframe:** Harvest shows the project's lifetime (All time) by default. Track2 opens
  monthly-reset budgets on Month (Chasity's #6 note, "default to a specific one dep…", is cut off).
- **Client contacts (#3):**
  - Harvest has a **Fax** field (needs a column).
  - Harvest manages contacts from the Clients list (Add contact / Edit next to each contact); Track2 does it on the client page.

## BugHerd card updates to post (pending)
To be posted on each card in BugHerd project 541260 (via the API with `BUGHERD_API_KEY`, or Claude in
Chrome). **FIXED** cards: post the comment, then move to a "Ready for review"/QA column if one exists,
otherwise "Done". Never close or delete (Chasity closes after checking). **NEEDS INFO** cards: post the
comment, leave the status, and assign to Chasity if possible. Afterwards, record what was posted here.

API notes (BugHerd API v2):
- Base: `https://www.bugherd.com/api_v2/`. Auth: HTTP basic, API key as the username, `x` as the password.
- List tasks: `GET projects/541260/tasks.json`. The `local_task_id` is the #number on the board.
- Comment: `POST projects/541260/tasks/{id}/comments.json`
- Status: `PUT projects/541260/tasks/{id}.json`
- Check the project's columns first; boards can have custom ones.

| # | Type | Comment |
|---|---|---|
| 1 | FIXED | Fixed and live (Oct 12). The time entry Project dropdown now lists only active projects (archived projects and projects of archived clients are hidden). It's grouped by client and you can type to filter. Please check and close if it looks right. |
| 2 | FIXED | Fixed and live. Admins and project managers have a "Teammates" button at the top right of the timesheet. Pick a person to view, add and edit their time and start or stop their timers; an amber banner shows whose timesheet you're editing. Project managers can do this on projects they manage. Please check and close if it looks right. |
| 3 | FIXED + Q | Fixed and live. On a client's page each contact now has Edit (first and last name, title, email, office and mobile phone). Question: Harvest also has a Fax field and edits contacts from the Clients list. Do you want either of those? |
| 6 | FIXED + Q | Fixed and live. The project page has a timeframe picker: Week, Semimonth, Month, Quarter, Year, All time and Custom, with arrows. Question: your note was cut off after "it should default to a specific one dep…". What should it default to? Harvest uses All time; right now projects with a monthly budget open on Month and everything else on All time. |
| 8 | FIXED | Fixed and live. The Team tab now only shows hours per person (billable, non-billable, billable amount) for the selected timeframe. Adding or removing people and PM settings moved to Edit project, linked from the tab as "Manage team". Please check and close if it looks right. |
| 9 | FIXED | Fixed and live. Report column headers sort when clicked; click again to reverse. Please check and close if it looks right. |
| 11 | FIXED | Fixed and live. The Time, Expenses and Profitability reports all have the timeframe picker (including Semimonth and Custom). It carries across tabs and into the CSV export. Receivables stays "as of today" because it's an aging report. Please check and close if it looks right. |
| 13 | FIXED | Fixed and live. Recurring invoices have "Invoices to issue" (blank means no limit). Each profile shows how many are left or "No end", and it stops after the last one. Please check and close if it looks right. |
| 14 | FIXED | Fixed and live. Invoices now show a large status banner at the top using Harvest's statuses and colors: Draft, Sent (due in N days), Late (N days late), Paid (paid on date), Written off. Please check and close if it looks right. |
| 16 | FIXED | Fixed and live. The Project dropdown on the expense form is grouped by client. Please check and close if it looks right. |
| 17 | FIXED + Q | Fixed and live. The Project and Category fields on expenses filter as you type (the time entry form does too). Question: is there anywhere else you want type-to-filter? |
| 18 | FIXED | Fixed and live. Opening one Actions menu closes any other; Escape or clicking outside also closes it. Please check and close if it looks right. |
| 19 | FIXED | Fixed and live. The Assigned projects tab defaults to active projects, with Active / Archived / All. Please check and close if it looks right. |
| 20 | FIXED + Q | Fixed and live. The tab defaults to active people, with Active / Archived / All. Question: in Harvest this tab is "Assigned people", meaning the people a manager manages (for approvals, reports and editing their time). Track2 currently shows teammates who share a project. Do you want Harvest's version? |
| 21 | FIXED | Fixed and live. Team filters apply as you type; there's no Apply button. Please check and close if it looks right. |
| 4 | NEEDS INFO | Question: for "Export to Google Drive", should it save the CSV file into a Drive folder or create a Google Sheet? And into whose Drive: yours, or a shared Big Sea folder? |
| 10 | NEEDS INFO | Same question as #4; one Google Drive integration would cover both. |
| 5 | NEEDS INFO | Question: which element is "What is this?" about? The note doesn't say. Could you circle it or add a screenshot? |
| 7 | NEEDS INFO | Question: which section is too easy to click by accident? Once we know, we'll move it or add a confirmation. |
| 12 | NEEDS INFO | Question: should "By Category" be removed, moved below "By client", or left as it is? |
| 15 | NEEDS INFO | Question: which element is "over here"? Could you circle it or add a screenshot? |

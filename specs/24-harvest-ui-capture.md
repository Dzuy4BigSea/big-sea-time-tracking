# 24 — Harvest UI capture (parity reference)

Goal: Track2 should match Harvest's UI and behavior. Cloud Claude sessions can't see Harvest's screens
(only its help center via the Harvest connector), so screen-level detail comes from a capture run in a
browser that's signed in to Harvest (Claude in Chrome, or `claude --chrome` locally).

**Status (2026-10-12):** notes for screens 1–6 captured below (Claude in Chrome). Screens 7–12 are not captured yet.
Use the notes to drive the layout pass on each screen.

## Capture prompt (paste into Claude in Chrome, signed in to Harvest)

```
I'm rebuilding these Harvest screens in another app and need exact UI parity notes.
Look only, change nothing in Harvest. For EACH screen below, take a screenshot and write down:
- layout top to bottom (what sits where: left/right, above/below the table)
- every control: exact label text, type (button, dropdown, tabs, search box, checkbox), default value, and every option in each dropdown in order
- table columns in order, which headers are sortable, what clicking a row does
- colors/badges/banners and their exact wording
- what changes when you interact (e.g. does a filter apply instantly; does a menu close when another opens)

Screens:
1. Time (timesheet), Week view: the "+ Track time"/new entry form, especially the Project and Task dropdowns (grouping, search, archived projects?).
2. Time: the Teammates button top right. Open a teammate's timesheet; capture the banner wording and what you can do there (add entry, start timer, edit, delete).
3. Manage > Clients: how contacts are listed under a client, the Add contact and Edit contact forms (every field), Update/Delete buttons.
4. Projects > open an active project (project analysis page): summary area, the timeframe dropdown (every option, default), Tasks tab and Team tab tables (columns, sortable headers, row click), Invoices tab.
5. Projects > Edit project: the Team section (adding people, project manager checkbox, rates).
6. Reports > Time: timeframe dropdown (all options), the arrows, group-by tabs, table columns and sorting.
7. Reports: the expense report(s): timeframe options, groupings available (by client/project/category/team?), columns.
8. Invoices > Recurring: new recurring invoice form, especially the schedule fields and "number of invoices to issue"; how a recurring row shows remaining/finished.
9. Invoices: open one Draft, one Sent (not due), one Late, one partially paid, and one Paid invoice. Capture the status badge/banner at the top of each, the exact wording, and the colors.
10. Expenses: the Track expenses form (Project dropdown grouping + type-to-filter, Category dropdown), and how the expense list is grouped.
11. Team: the list page (search box, filters, Actions menu per row, View archived people).
12. Team > Edit a person: the Assigned projects tab and Assigned people tab (what each lists, filters, how to add/remove).
```

## Already confirmed from Harvest's help center
- **Timesheet:**
  - "Teammates" button top right. On a teammate's sheet you can add/edit/delete entries and start/stop timers.
  - The banner reads "Changes will save to {name}'s timesheet." with a "Resume editing your own timesheet" link.
  - Managers act on projects they manage and/or their assigned people.
- **Timeframes:** Week, Semimonth, Month, Quarter, Year, (Fiscal year), All time, Custom.
- **Project analysis page:**
  - Tasks / Team / Invoices tabs, with sortable headers and a timeframe dropdown at the table's top left.
  - It defaults to the project's lifetime.
- **Invoice statuses:** Draft, Sent, Late, Paid, Written off (colors: gray / blue / red / green).
- **Client contacts:**
  - Fields: First name, Last name, Title, Email, Office phone, Mobile phone, Fax.
  - Managed from Manage > Clients (Add contact / Edit next to each contact; Update contact / Delete contact).
- **Assigned people:** a manager → people assignment. It drives approval, Team visibility, reports, and editing their time.

## Captured notes (2026-10-12)

### 1. Time – Week view
- Page title "Timesheet" top-left; top-right segmented toggle [Day | Week] (active = peach fill, orange border), then "Teammates ˅" button.
- Row below: green "+ Track time" button; date nav pill [← | 📅 "This week 12 – 18 Oct 2026" | →]; when not on current week label becomes "05 – 11 Oct 2026" and a blue underlined link "Return to this week" appears to the right (Day view: "Return to today").
- Below: label "What would you like to add to your timesheet?" + AI natural-language input (sparkle icon, rotating placeholder e.g. "Try: 2 hours today on design work", "Try: Log 8 hours for Friday", "Try: Half a day on Monday for…"), orange circular → submit button, pencil icon.
- Empty week: beige card with random quote + attribution, and blue "+ Add row" link.
- Below grid: split button "Copy from last week (projects only)" + ˅ menu with one option "Copy from last week (with entries)". (Day view equivalent: "Copy from 3 days ago (projects only)" – references last day with time.)
- Week grid (populated): columns Project/task text | notes icon | Mon..Sun (header "⏱ Mon / 05 Oct"; clock icon on weekdays that have time) | row total | ✕ delete-row button. Cells are editable h:mm inputs. Footer row: daily totals + week total. Below: "+ Add row" button + Copy split button.
- Row text: **[CODE] Project name** (Client) newline Task.
### "+ Track time" in Week view = modal "Add row to this timesheet"
- Label "Project / Task"; Project select (two-line: client small grey above, project name); Task select; buttons green "Save row" + outlined "Cancel". No notes/hours in week-view modal.
- Default project = top of list (most-used); task default = most-used task for that project (e.g. "Last Call").
- Project dropdown: search box "Search..." (autofocused) + sort icon button (⇅) opening menu: Most Recent / Most Used (✓ default) / A to Z / Z to A. Options grouped under bold client headers; with Most Used sort, the top client groups are ordered by usage (Brooks Rehabilitation, Revs Institute, Warren Wilson College) then remaining clients alphabetical (numeric "1" first). Project rows show "[CODE] Name". Highlighted row = black fill, white text.
- Type-to-filter: matches project AND client names, matched substring underlined; client group headers kept; first match auto-highlighted; Enter selects. No match: italic grey "No results match <query>". Search text is cleared when dropdown reopens.
- Only active projects you're assigned to show (no archived section).
- Task dropdown: same search + sort menu (Most Recent / Most Used ✓ / A to Z / Z to A); tasks grouped under "Billable" (and "Non-billable" when present).
- Esc closes the dropdown AND the whole modal. Opening Task dropdown closes Project dropdown (only one open at a time).

### 2. Teammates
- "Teammates ˅" opens dropdown with "Search..." box; groups "Employees" then "Contractors"; names like "BS: Adriana Generallo" (includes yourself). Type-to-filter, Enter opens.
- Teammate timesheet banner (pale yellow/amber bg, amber border, avatar left): title "BS: Thomas Kelly's timesheet"; line "Changes will save to BS: Thomas's timesheet. Resume editing your own timesheet" (last part is a blue underlined link).
- Selected week/day is preserved when switching teammate.
- Week view on teammate: full editing grid (edit cells, notes, ✕ delete row, + Add row, Track time). "Copy from last week" is disabled (greyed) when teammate has no rows.
- Day view on teammate: day tabs Mon..Sun with totals (active underlined orange), "Week total" right; each entry: bold project (client), task, notes small grey; duration; "⏱ Start" button (can start timer for teammate) and "Edit" button; "+ Track time" link + "Total: 7:00".
- Edit modal "Edit time entry for Monday, 05 Oct": Project/Task selects, notes textarea, duration box (selected), green "Update entry", "Cancel", right side links "Change date" (grey underlined) and "Delete" (red underlined).
- New entry modal (Day view) "New time entry for Monday, 05 Oct": selects, "Notes (optional)", duration "0:00"; primary button reads "Start timer" when duration empty and switches to "Save entry" once a duration is typed.

### 3. Manage > Clients (sidebar "Clients")
- Header: "Clients" left; right: green split button "+ New client" with ˅ (menu: "+ New contact"), "⚡ Actions ˅" (Archive clients / Reactivate clients / — / View all bulk actions →), "Import/Export ˅" (View archived clients / — / Import clients from CSV / Import contacts from CSV / — / Export clients / Export contacts). Opening one menu closes the other.
- Centered column (~520px): AI box "What would you like to do with your clients?" (placeholder "Try: How much have we billed this quarter?"); search input "Filter by client or contact".
- Filter applies as you type (short debounce, no Enter); input turns peach-tinted and a "✕ Clear filter" button appears beside it. Matching a contact shows that client's whole card (all contacts).
- One bordered card per client, alphabetical (numeric names first): header row [Edit] **Client name** ......... [+ Add contact] on light grey bg; each contact row below: [Edit] Name (normal weight) / second line small grey: "Title, email, office phone (office)" joined by commas (e.g. "(invoices), Zachary.Gearon@…", "Director of Public Affairs…, lori@…, 612-840-4334 (office)"). Clients with no contacts show header row only.
- Add contact page: H1 "New contact for a)plan Coaching"; helper text "No email is sent when adding a contact. The email address is captured for your own reference and for the convenience of sending invoices to the client directly from Harvest." Fields (label left, input right): First name, Last name, Email, Invoice email default (select: None* / Recipient / CC / BCC), Title, Office number, Mobile number, Fax number. Buttons: green "Save contact", "Cancel".
- Edit contact page: H1 "Zachary Gearon (a)plan Coaching)" with outlined "Delete contact" button top-right; same fields; buttons green "Update contact", "Cancel". URL /clients/:id/contacts/:id/edit.
- Edit client page: "← Back to Clients", H1 "Edit client"; Client name; Address (textarea); Preferred currency (select, default "Account default (United States Dollar - USD)", then EUR, GBP, AUD, CAD, JPY, then full ISO list A–Z); divider; Invoice due date (select Upon receipt / Net 15 / Net 30 / Net 45 / Net 60 / Custom + number box "days after invoice issue date"); Tax [ ]% + link "Enable second tax"; Discount [ ]%; buttons "Save client" (green) / "Cancel". Right sidebar: light-blue box "Archived projects" listing archived project names; pale-yellow box with link 'Archive "a)plan Coaching"'.

### 4. Projects > project analysis page (e.g. [B-BRA005] Blue Ridge Associates Support Retainer 2026)
- Projects list (context): header buttons "+ New project" (green), "⚡ Actions ˅", "Import", "Export", search "Search by project or client"; AI box "What would you like to do with your projects?"; "Active projects (3) ˅" filter left; right: "Clear filters" link, "Client: <name> ˅", "Filter by manager ˅". Columns: ☐ | Client (project rows grouped under underlined client name) | Budget | Scheduled (orange Forecast icon, orange top border) | Delta | Spent | progress bar | Remaining (n.nn + (x%) ; ⚠ red triangle when low) | Costs | "Actions ˅" per row. Project name bold + type pill ("Time & Materials", "Fixed Fee"). Clicking the name opens the analysis page.
- Top bar: "← Back to Projects" left, search box right.
- Header: client name (small bold) above H1 "[CODE] Project name"; pill "Time & Materials"; "📅 01 Jan 2026 - 31 Dec 2026 (11 weeks left)"; project notes (2 lines, faded) + "Show more"/"Show less" link. Right: "✎ Edit project" button, "Actions ˅" menu (Pin / Duplicate / — / Archive / Delete).
- Chart card: toggle [↗ Project progress | ılı Hours per week] (active = peach); right: [← | This week | →] nav (disabled at current). Progress = cumulative line with grey "Budget: 118.25 hours" line/label; current week column shaded light blue labelled "This week". Hours per week = dark bar chart.
- 5 summary cards in a row (always all-time; do NOT change with the timeframe dropdown):
  1 "Total hours" 112.55 / Billable 112.55 / Non-billable 0.00
  2 "Budget remaining (5%)" 5.70 ⓘ / Total budget 118.25 / blue progress bar
  3 "Internal costs" $10,947.30 / Time / Expenses
  4 "Invoiced amount" $19,500.00
  5 "Uninvoiced amount" – here text "This project's billable rates were never set." + link "Set billable rates".
- Tabs: Tasks | Team | Invoices (active = bold + orange underline). Forecast promo banner on Tasks tab ("Get ahead with task-level scheduling in Forecast", green "Learn more", "Dismiss").
- Table toolbar: title "All time" (default) – when a period is chosen it becomes "[←][→] This Month: Oct 2026" (arrows step periods). Right: timeframe dropdown + "Export ˅" (Excel / CSV / Google Drive).
- Timeframe options in order: Week, Semimonth, Month, Quarter, Year, All time (default), Custom. Selection applies instantly and persists when switching Tasks/Team tabs.
- Tasks table columns: Billable tasks | Hours | Billable amount | Costs (and a "Non-billable tasks" section when present) + bold Total row. All headers sortable (click); default Hours descending (shown "Hours ^"); name sort shows "˅" for A→Z. Hours values are blue underlined links → Detailed time report (/reports/detailed) filtered. Rows with time have ">" chevron; clicking the row expands (light-blue highlight) to show people under that task each with "Manager" pill. "$0.00 ⚠" with tooltip "This amount might be wrong because your project is missing billable rates. Fix those rates".
- Team table: Team | Hours | Billable amount | Costs. Rows: avatar (photo or initials circle) + "BS: Name" + pills "Manager", "Archived". Expand row → tasks for that person. Same sort/timeframe behaviour.
- Invoices tab: buttons "+ New invoice", "Link invoice" (disabled); columns Status (green "Paid" pill) | Issue date | Paid on | ID (blue link) | Subject | Pre-tax amount (bold) | "Unlink" button per row (disabled for some).

### 5. Projects > Edit project (/projects/:id/edit) – Team section
- Page: "← Back to Project"; H1 "Edit project"; label-left form: Client (locked w/ note "You can't change the client of a project with linked invoices. To edit the client, please unlink invoices via the project's Invoices tab."), Project name, Project code ("Last project code for client: B-BRA008" + helper), Dates (Starts on / to / Ends on), Tags, Billing currency ("Same as client — USD" + list), Notes, Permissions radios ("Show project report to Administrators and people who manage this project" / "…to everyone on this project", each with "What will people see?" link), Project type = 3 big tiles [Time & Materials "Bill by the hour, with billable rates" | Fixed Fee "Bill a set price, regardless of time tracked" | Non-Billable "Not billed to a client"] (active = peach); inside peach panel: Billable rates select (No billable rate / Project billable rate / Person billable rate / Task billable rate), Budget select (No budget / Total project fees / Fees per task / Total project hours / Hours per task / Hours per person) + value + "hours"; checkboxes "Budget resets every month", "Send email alerts if project exceeds [80.00] % of budget", "Warn team members when they exceed the budget ⓘ".
- Tasks card: header "Tasks" | "Assigned teammates Select All / None" | "Billable Select All / None"; light-blue note "Project teammates are assigned by default. Edit a task to limit who can track time to it."; rows: [✕] Task name … avatar stack (5 avatars + "+17") "✎ Edit" … orange checkbox (billable); "Add a task..." autocomplete input at bottom.
- Team card: header "Team" | column(s) | "Manages this project  Select All / None".
  - Columns depend on Billable rates setting: with "No billable rate" only "Cost rate"; with "Person billable rate" a "Billable rate" column appears left of "Cost rate" (switches instantly, client-side).
  - Row: [✕ remove] avatar (photo or dark initials circle) "BS: Name" … rate cell: grey pill "Person default" + "$95.00" + blue link "Apply custom rate" (or italic grey "Missing rate" + link) … orange checkbox = project manager.
  - Archived person row: greyed background, small "Restore" button instead of ✕, checkbox disabled.
  - Adding: "Assign a person..." autocomplete input at bottom of list; dropdown lists only people NOT yet assigned (e.g. "BS: Amber Stansfield"); selecting adds a row.
  - "Apply custom rate" opens right-side slide-over "Edit cost rate" (or billable rate) with "✕ Close": question "Which cost rate would you like to use for BS: Chasity?"; segmented [Default cost rates | Custom cost rates]. Default shows "Person default (Applied)" table Cost rate | Start date | End date ("$95.00 | All prior | All future") + "Time tracked to this project will use BS: Chasity's default cost rates. View default cost rates". Custom shows "Time tracked to this project will use BS: Chasity's custom cost rates below." + green "+ New cost rate" + empty beige box "No cost rates.". NOTE: toggling Default/Custom SAVES IMMEDIATELY (green toast "✓ Assignment updated." top-center) – it is not part of the Update project form.
- Invoice values: Invoice due date (Upon receipt / Net 15 / Net 30 / Net 45 / Net 60 / Custom), PO Number, Tax % + "Enable second tax", Discount %. Sticky footer: green "Update project" + "Cancel".
- The edit page blocks navigation when the form is dirty (leave-page guard).

### 6. Reports > Time (PARTIAL)
- Header "Reports" + green "+ New report ˅"; sub-tabs: Time | Profitability | Contractor | Invoicing | Saved reports.
- Toolbar: timeframe button "Week ˅" → Week / Semimonth / Month / Quarter / Year / All time / Custom; then nav pill [← | 📅 "This week 12 – 18 Oct 2026" (Change date) | →]; right: "Save report".
- Summary card: Total hours 38.85 + donut (56%) with legend Billable 21.81 / Non-billable 17.04; Billable amount $377.85 + checkbox "Include Fixed Fee projects" + note "Billable amounts for Fixed Fee projects are based on billable rates. The billable amount may not match the invoiced amount."; Uninvoiced amount $377.85 "Excludes Fixed Fee projects".
- Group-by tabs: Clients | Projects | Tasks | Teammates (URL ?tab=projects|tasks|users). Right of tabs: checkbox "Active projects only", "Detailed report" button, "Export ˅" (Export simple to Excel / CSV / PDF; Export detailed to Excel / CSV / PDF / Google Drive; Custom export), print icon.
- Columns (all sortable except the bar column):
  - Clients: Name (default sort A→Z, "Name ˅") | Hours | [bar] | Billable hours ("1.30 (9%)") | Billable amount ("—" when no rate).
  - Projects: Name | Clients | Scheduled | Delta | Hours | [bar] | Billable hours | Billable amount (+ Forecast promo row "Example Project with Forecast … Dismiss").
  - Tasks: Name | Hours (default sort) | [bar] | Billable hours | Billable amount.
  - Teammates: Employees/Contractors split bar on top; Name (default) | Scheduled | Delta | Hours | [bar] | Utilization | Billable hours | Billable amount; rows grouped "Employees" / "Contractors" with subtotals; avatars.
- Name is a link (drills into that client/project/person report); Hours value is a blue link → Detailed time report filtered; hover bar shows "Billable hours: 100% / Non-billable hours: 0%". Total row at bottom.

### NOT YET CAPTURED: 7 (expense reports), 8 (recurring invoices), 9 (invoice statuses), 10 (expenses form), 11 (team list), 12 (edit person tabs); also New report menu items and date-picker for screen 6.

# 24 — Harvest UI capture (parity reference)

Goal: Track2 should match Harvest's UI and behavior. Cloud Claude sessions can't see Harvest's screens
(only its help center via the Harvest connector), so screen-level detail comes from a capture run in a
browser that's signed in to Harvest (Claude in Chrome, or `claude --chrome` locally).

**Status (2026-10-12):** prompt sent; notes not back yet. When they arrive, save them below under
"Captured notes" (or link the Google Doc) and use them to drive the layout pass on each screen.

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

## Captured notes
_(pending)_

# 03 — Clients, Projects, Tasks & Rate Resolution

This is where billing behavior is configured. The single most important algorithm in the product — **rate resolution** — is specified here.

## Clients

- CRUD by `admin`/`manager`. A client has a name, default currency, address, and a default invoice contact.
- Currency is immutable once the client has any invoice (prevents mixed-currency drift).
- Archiving a client hides it from pickers but preserves its projects and history; you cannot archive a client with a running timer against one of its projects.

## Projects

- Belong to one client. Carry `billingMethod`, `budgetMethod`, rates, and dates (see [01](01-data-model.md)).
- **Task assignments**: an admin/manager/PM picks which global tasks apply, and may override billable flag and rate per project. This is done only on **Edit project** (`/projects/[id]/edit`, the Tasks card, like Harvest); the project detail page shows time per task but has no task management.
- **User assignments**: who may log time. A user not assigned to a project cannot log time to it (unless account setting `allowAllUsersAllProjects=true`).
- Archiving a project locks it to new time entries but keeps existing entries editable until invoiced/approved.
- **Notes** (Harvest's Notes field; BugHerd #24): editable on New project and Edit project by anyone who may edit the project, as **rich text** (bold, italic, underline, bulleted/numbered lists, links). Stored as sanitized HTML in `Project.notes`; notes imported from Harvest are plain text and still display with their line breaks. Shown on the project page header and in an invoice's "Show project context" for Fixed Fee lines. Rules in `modules/projects/notes.ts`.

## Tasks

- A global, account-level list (e.g. "Design", "Development", "Project Management").
- `defaultBillable` and `defaultHourlyRateCents` seed new project assignments.
- A task in use by any time entry cannot be hard-deleted, only archived.

## Rate resolution algorithm (canonical — revised from live observation)

Harvest uses a **two-level** billing model and **effective-dated** rate tables. Resolution runs in `modules/projects/resolveRate.ts` and is the reference for **INV-2**.

**Step 1 — Billable?**
```
if project.projectType == 'non_billable':        isBillable = false
elif taskAssignment.billable is set:             isBillable = taskAssignment.billable
else:                                            isBillable = task.defaultBillable
```
If `isBillable == false`, `billableRateCents = null` and stop.

**Step 2 — Rate source (only when billable), by the two levels:**
```
projectType == 'fixed_fee':
    # entries record hours with billableRateCents = 0;
    # the project's projectFeesCents is what gets invoiced, not hours × rate.
    rate = 0

projectType == 'time_and_materials':
    switch project.billableRateMethod:
      'none':    rate = null            # "No billable rate" — valid; amount unknown
      'project': rate = project.projectHourlyRateCents
      'person':  rate = projectUserAssignment.hourlyRateCents        # per-project override WINS
                        ?? effectiveRate(PersonBillableRate, userId, entry.spentDate)
      'task':    rate = taskAssignment.hourlyRateCents               # per-project override WINS
                        ?? task.defaultHourlyRateCents
```

**`effectiveRate(table, ownerId, date)`** = the row for `ownerId` whose `[startDate, endDate]` contains `date` (null bounds = open-ended). Ranges never overlap. This is why the entry's **date** matters: a rate change with a future start date does not affect past entries, and back-dated entries get the rate that was in force then.

If a billable method resolves to a missing rate, the entry still saves but is flagged `rateMissing=true` (warning; must be resolved before it can be invoiced).

**Re-derivation vs snapshot.** `billableRateCents` is cached on the entry for performance, but because rates are date-effective it is **re-derived** whenever the entry is `open` and its date/project/task/person changes. Once the entry locks (`approved` or `invoiced`) the cached value is frozen so historical invoices never shift. An admin "re-apply rates" bulk action refreshes cached values on `open` entries.

**Cost rate** (for margin/profitability) resolves the same way against `PersonCostRate` by `spentDate`. Cost is always in the account base currency; billable amounts use the project billing currency.

## Budgets

- `budgetMethod` interpretation:
  - `hours_total` / `hours_per_task` / `hours_per_person` → `budgetValue` in minutes.
  - `fee_total` → `budgetValue` in cents of billable amount.
  - `cost_total` → `budgetValue` in cents of internal cost (uses `user.defaultCostRateCents`).
- Budget "spent" = sum over the (optionally monthly-reset) period.
- When spent ≥ `budgetAlertPercent`, notify project managers + admins once per threshold crossing (see [08](08-nonfunctional.md) notifications).

## Acceptance criteria

- **AC-PROJ-001** — *Given* a T&M project with `billableRateMethod='project'` at $150/h, *when* a member logs 90 min, *then* the entry's `billableRateCents=15000` and billable amount = $225.00.
- **AC-PROJ-002** — *Given* a T&M project with `billableRateMethod='task'` where the "Design" assignment overrides to $120/h and the global task default is $100/h, *when* a Design entry is logged, *then* rate = $120/h (assignment beats task default).
- **AC-PROJ-003** — *Given* a T&M project with `billableRateMethod='person'` and a user with no per-project override, *when* they log time, *then* rate = the person's effective `PersonBillableRate` for that date; if none exists, `rateMissing=true`.
- **AC-PROJ-004** — *Given* a `non_billable` project, *when* any time is logged, *then* `isBillable=false` and `billableRateCents=null` regardless of task settings.
- **AC-PROJ-004b** — *Given* a T&M project with `billableRateMethod='none'`, *when* time is logged, *then* the entry saves, `billableRateCents=null`, and the project shows the "billable rates were never set" prompt; internal cost is still computed.
- **AC-PROJ-005** — *Given* a person with billable rate $150 effective through 2026-06-30 and $175 from 2026-07-01, *when* entries are logged on 2026-06-15 and 2026-07-15, *then* they resolve to $150 and $175 respectively (effective-dated).
- **AC-PROJ-005b** — *Given* an **invoiced** entry, *when* an admin later edits any rate table, *then* the invoiced entry's cached rate is unchanged; an `open` entry re-derives.
- **AC-PROJ-006** — *Given* a user not assigned to a project (and `allowAllUsersAllProjects=false`), *when* they try to log time to it, *then* it is rejected.
- **AC-PROJ-007** — *Given* a project with `budgetMethod=hours_total`, budget 40h, alert 80%, *when* logged time reaches 32h, *then* a single budget alert fires to PMs/admins; reaching 33h does not re-fire.
- **AC-PROJ-008** — *Given* a client with an issued invoice, *when* an admin tries to change its currency, *then* the change is rejected.
- **AC-PROJ-009** — *Given* an archived project, *when* a user tries to start a new timer on it, *then* it is rejected; existing un-invoiced entries remain editable.
- **AC-PROJ-010** — *Given* a `fixed_fee` project, *when* time is logged, *then* entries record hours with `billableRateCents=0`, and `projectFeesCents` is what appears on the invoice (not hours × rate). (See [05](05-invoicing.md).)
- **AC-PROJ-011** — *Given* a new project is created, *when* it is saved, *then* every Task with `autoAddToNewProjects=true` (Common task) is auto-assigned to it; Other tasks are not.
- **AC-PROJ-012** — *Given* a user who may edit a project, *when* they format its Notes (bold, italic, underline, lists, links) on New or Edit project and save, *then* the formatting is kept and shown on the project page; clearing the editor clears the notes.
- **AC-PROJ-013** — *Given* a project whose notes are plain text from Harvest, *when* it is viewed or opened for editing, *then* line breaks and paragraphs are kept and any `<`, `>` or `&` in the text shows literally.
- **AC-PROJ-014** — *Given* notes containing scripts, event handlers, styles, iframes or `javascript:` links, *when* they are saved or shown, *then* that markup is removed (allowlist sanitizing on save and on display) and links open in a new tab with `rel="noopener noreferrer nofollow"`.
- **AC-PROJ-015** — *Given* a user who may edit a project, *when* they open Edit project and click "Add a task...", *then* the list shows every active task (the /tasks "Active tasks" list) not already on the project, alphabetically (case-insensitive, numbered tasks in number order), in a dropdown that scrolls inside itself with a visible scrollbar and is not cut off by the Tasks card; picking one adds it. The project detail page has no "Manage tasks on this project" section.

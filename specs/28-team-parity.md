# 28 — Team parity (Team overview + Edit a person + Assigned people)

Screens 11 and 12 of [specs/24](24-harvest-ui-capture.md). Neither screen has been captured from the live
Harvest account yet, so this spec is built from Harvest's help center (via the Harvest connector,
2026-10-14) plus [findings](findings.md) §H. Anything the help center doesn't state is marked
**UNVERIFIED — confirm in Harvest** and should be checked with the specs/24 capture prompt (screens 11, 12).

Related BugHerd cards ([specs/23](23-bugherd-feedback.md)): #18 single-open Actions menus, #19 Assigned
projects Active/Archived, #20 Assigned people (phase 2, agreed with Chasity), #21 live filters, #26
Employees/Contractors split.

## 1. Harvest behavior (help center)

Sources:
- [Team overview](https://support.getharvest.com/hc/en-us/articles/360048687431-Team-overview) (TO)
- [Person profiles](https://support.getharvest.com/hc/en-us/articles/360048687291-Person-profiles) (PP)
- [Making people assignments for Managers](https://support.getharvest.com/hc/en-us/articles/4422314817677-Making-people-assignments-for-Managers) (MPA)
- [Archiving, deleting, and restoring people](https://support.getharvest.com/hc/en-us/articles/360048687311-Archiving-deleting-and-restoring-people) (ADR)
- [Person pages](https://support.getharvest.com/hc/en-us/articles/360048181772-Person-pages) (PPg)
- [Permissions](https://support.getharvest.com/hc/en-us/articles/44171549176077-Permissions) (PERM)
- [What can people with Manager permissions never access](https://support.getharvest.com/hc/en-us/articles/30704133376269-What-can-people-with-Manager-permissions-never-access-in-Harvest) (MGR-NEVER)
- [Timesheet approval FAQ](https://support.getharvest.com/hc/en-us/articles/360048181912-Timesheet-approval-FAQ) (APPR)
- [Timesheet submission reports](https://support.getharvest.com/hc/en-us/articles/27570699929229-Timesheet-submission-reports) (TSR)
- [What can people see when I share a report](https://support.getharvest.com/hc/en-us/articles/14820451322125-What-can-people-see-when-I-share-a-report-with-them) (SHARE)
- [How to add and import people](https://support.getharvest.com/hc/en-us/articles/360048181732-How-to-add-and-import-people) (ADD)
- [How do I assign a person to multiple projects?](https://support.getharvest.com/hc/en-us/articles/360048687351-How-do-I-assign-a-person-to-multiple-projects) (MULTI)
- [Setting billable rates](https://support.getharvest.com/hc/en-us/articles/360048181492-Setting-billable-rates), [Editing billable rates](https://support.getharvest.com/hc/en-us/articles/12522267831181-Editing-billable-rates), [Setting and editing cost rates](https://support.getharvest.com/hc/en-us/articles/360048687391-Setting-and-editing-cost-rates) (RATES)
- [Assigning, editing, and deleting roles](https://support.getharvest.com/hc/en-us/articles/360048687411-Assigning-editing-and-deleting-roles), [Creating & Assigning Permissions Profiles](https://support.getharvest.com/hc/en-us/articles/45402906166413-Creating-Assigning-Permissions-Profiles) (ROLES)

### 1.1 Team overview (screen 11)
- **Who sees it:** "Only Administrators and Managers with assigned people can see the team overview" (TO).
- **Week at a time:** arrow buttons top left; after leaving the current week a **Return to this week** link appears (TO).
- **Summary:** total time tracked this week, everyone's total capacity, billable vs non-billable, and a bar for how much capacity is used (TO). Rounded if the account rounds.
- **Everyone dropdown** (top right): filter by **My pins** or a **role**; type to narrow a long role list (TO). Managers with assigned people also get **My assigned people** (TSR describes the same dropdown on Pending approval).
- **Default scope:** "Administrators will see everyone in the account while Managers will see only their assigned people" (TO).
- **List:** split into **Employees** and **Contractors** when both exist (TO). Each row has:
  - a **dot** left of the name: orange = timer running, gray = not (TO);
  - a label right of the name: **Admin** for Administrators, **Manager** for Managers, none for Members (TO). With Harvest's newer six base profiles the label text per profile is UNVERIFIED — confirm in Harvest;
  - time tracked this week, capacity, billable time, and a bar of billable (darker) and non-billable (lighter) time against capacity, blue up to capacity and red over it (TO);
  - name links to the **Person page** (time by day, by project, by task, plus their week's timesheet) (TO, PPg).
- **Actions dropdown per row** (TO, PPg, ADR):
  - **Edit**: opens the profile. Admins edit everything; Managers only some fields.
  - **Pin**: moves the person to the top of *your* overview; then filter with My pins. Pins also filter Time > Pending approval.
  - **Archive** (Administrators): anyone except the Account Owner; not yourself. Archived people can't sign in; data stays for reports and invoices.
  - **Delete** (Administrators): only people with no time or expenses; not yourself or the Account Owner. Invoice/estimate history then shows "Deleted user".
  - Exact menu order and any extra items (e.g. "Resend invitation") are UNVERIFIED — confirm in Harvest.
- **View archived people** button at the top right, shown only if anyone is archived (TO). The archived list has **Restore** and **Delete** per person; only Administrators restore/delete (TO, ADR). Restoring re-sends an invitation and does **not** re-add project assignments (ADR).
- **+ Invite person** (ADD): name, email (unique), employee ID, roles, capacity, rates → Invite and continue → permissions → assign projects → (Managers) assign people.

### 1.2 Edit a person (screen 12)
Profile sections (left menu): **Basic info, Rates, Assigned projects, Assigned people, Permissions, Notifications (own profile only), Security** (PP).
- **Who edits:** Administrators edit anyone; Managers edit their own and *some sections* of their assigned people's profiles; Members only their own (PP).
- **Basic info** (PP): First name, Last name, Work email, Employee ID, Type (Employee/Contractor), **Roles** (admins only), **Capacity** (admins only), **Timezone** (defaults to the account's), Photo, Notifications, Home (own profile). Save button "Update info" (from the change-email article).
- **Rates** (RATES): "+ New billable rate" and "+ New cost rate" with an effective date, then "Add rate". Admins see/edit all; Managers see/edit billable rates for assigned people and managed projects *only with the special permission*; Managers never see cost rates (MGR-NEVER).
- **Assigned projects** (PP, MULTI):
  - Everyone can see which projects they're on; admins and some managers can change it.
  - "Find and select projects to assign" multi-select; **Assign to all projects** at the bottom of the menu (also assigns future projects; a **Disable** link turns that off, **Assign to all future projects** turns it back on); green **Assign projects** button.
  - **Manages this project** checkbox column with an **All** link. Ticking it for a Member raises them to Manager after a "Yes, update permissions" confirmation.
- **Assigned people** (PP, MPA): see §3.
- **Permissions** (PP, PERM): admins change anyone's; others only view their own or their assigned people's. Six base profiles (Member, Project Manager, People Admin, Accounting, Executive Manager, Administrator) plus custom profiles built on a base with up to 45 permissions; "Update permissions" button.
- **Notifications:** own profile only (PP).
- **Security:** nobody sees another's password; admins (and managers with assigned people) get **Reset password**, or **Resend invitation** if the person hasn't signed in yet (PP).

## 2. Acceptance criteria

### Team overview
- **AC-TEAM-001** Given the Team page, when it loads, then it shows one week (the account's current week by default) with ← / → and, when not on the current week, a "Return to this week" link to it.
- **AC-TEAM-002** Given people of both types, then rows are grouped Employees then Contractors (BugHerd #26); with one type there is no section header.
- **AC-TEAM-003** Given the Everyone dropdown, then options are, in order: Everyone (or "My assigned people" first for a manager with assigned people), My pins, each role (alphabetical), then Track2's access-level and Employee/Contractor filters. Choosing one applies immediately (BugHerd #21).
- **AC-TEAM-004** Given a Manager with assigned people and no filter chosen, then only their assigned people are listed; choosing Everyone lists everyone the page otherwise shows. Given anyone else, the default is Everyone.
- **AC-TEAM-005** Given a row, then a dot left of the name is orange while that person has a running timer, gray otherwise.
- **AC-TEAM-006** Given I pin someone (Actions → Pin), then they move to the top of my list (above the others in their Employees/Contractors group), appear under My pins, and the menu offers Unpin. Pins are mine only.
- **AC-TEAM-007** Given each row's Actions menu, then it offers Edit (people managers), Pin/Unpin, and Archive (people managers, not on my own row); opening one menu closes any other (BugHerd #18).
- **AC-TEAM-008** Given Archive, then the person can no longer sign in, keeps all their data, and leaves the active list. Archiving yourself or the Account Owner is refused server-side. Someone without `manage_people` can't archive, and a non-admin can't archive someone who outranks them (`checkSecurityChange`).
- **AC-TEAM-009** Given archived people exist, then a "View archived people (n)" button shows; the archived list has Restore per person for people managers. Restoring doesn't re-add project assignments.
- **AC-TEAM-010** Given billable and non-billable time, then each row's bar shows billable darker and non-billable lighter against capacity, and turns red over capacity; utilization = hours ÷ capacity.
- **AC-TEAM-011** (gap) Given a Member (no assigned people, no `manage_people`), then the Team overview isn't available (Harvest: admins and managers with assigned people only).
- **AC-TEAM-012** (gap) Given Delete on someone with no time or expenses, then they're removed; with any time or expenses only Archive is offered.

### Edit a person
- **AC-TEAM-020** Given the profile, then the left menu lists Basic info, Rates, Assigned projects, Assigned people, Permissions, Security (Notifications on your own profile only — gap).
- **AC-TEAM-021** Given Basic info, then it has Employee ID, Roles (admin-only, tag input), Timezone (defaults to the account's), alongside name, type, capacity.
- **AC-TEAM-022** Given Assigned projects, then Active / Archived / All pills default to Active (BugHerd #19), "Assign to all projects" + Disable exist, and a Manages column toggles PM status.
- **AC-TEAM-023** Given Assigned projects, then adding is a type-ahead multi-select ("Find and select projects to assign…", grouped by client, active projects only) with an "Assign projects" button.
- **AC-TEAM-025** (gap) Given Assigned projects, then an "All" link under Manages marks every assignment as managed, and ticking Manages for a Member asks to raise them to Manager.
- **AC-TEAM-024** Given Rates, then billable and cost rate histories with effective dates show; cost rates only to `view_cost_rates`; adding requires `set_rates`.

### Assigned people (BugHerd #20; see §3)
- **AC-TEAM-030** Given an Administrator on a Project Manager's Assigned people tab, then a "Find and select people to assign…" type-ahead multi-select (active people, not the manager, not already assigned; grouped Employees/Contractors) and an "Assign people" button add assignments.
- **AC-TEAM-031** Given an assigned person, then an ✕ next to their name removes the assignment (admin only).
- **AC-TEAM-032** Given a non-admin, then the tab is read-only (no picker, no ✕). Server actions re-check `edit_account_settings` and the account (INV-5).
- **AC-TEAM-033** Given a person who isn't a Project Manager, then the tab explains only Managers can have assigned people and offers no picker; existing rows (e.g. after a profile change) are still listed and removable.
- **AC-TEAM-034** Given a person assigned to managers, then their Assigned people tab says "Assigned to {managers}".
- **AC-TEAM-035** Each (manager, person) pair is stored once (unique); assigning twice is a no-op.
- **AC-TEAM-036** (phase 2) Given a Manager with assigned people, then they can view and edit (if they hold `view_edit_others_time`) those people's time and expenses, approve them, report on them, and edit first/last name and timezone on their profiles. See §3.3.

## 3. Assigned people — full spec (BugHerd #20, phase 2 per Chasity)

### 3.1 Harvest behavior
- "Team members with Manager permissions can be assigned a group of people for whom they can approve time and expenses and report on. **Only Administrators can make people assignments.**" (MPA)
- How: Team → Actions → Edit on the Manager → **Assigned people** tab → **Find and select people to assign...** (type or scroll) → **Assign people**. Remove with the **X** next to a name (PP).
- Managers can *view* assignments for themselves and their assigned people; only Administrators edit them (PP).
- A Manager with assigned people can (MPA):
  1. approve timesheets (time and expenses) for their assigned people (APPR: "If a Manager only manages people, they'll only be able to approve time and expenses submitted by their assigned people");
  2. see them on the Team overview, which defaults to them (TO);
  3. report on their time (Reports > Time, Detailed time) and expenses (Detailed expense) (MPA, SHARE);
  4. edit basic profile fields: **First name, Last name, Timezone** (MPA);
  5. resend their invitation (MPA, PP Security).
- Seeing and editing their timesheets: Managers see their assigned people's timesheets, and edit them only with the "edit time for others" permission (PPg). PERM: Project Manager = "View and edit time for themselves and their managed people and projects".
- Billable rates for assigned people only with the special rate permission; cost rates never (RATES, MGR-NEVER).
- Pending approval's Everyone dropdown offers **My assigned people** (TSR).
- UNVERIFIED — confirm in Harvest: whether an Administrator's profile shows the Assigned people tab at all, whether archived people stay assigned, and whether demoting a Manager to Member clears their assignments.

### 3.2 Track2 data model (built)
`ManagerAssignment(id, accountId, managerId → User, userId → User, createdAt)`, unique `(managerId, userId)`, indexes on `accountId` and `userId`, cascade on user/account delete. Migration `prisma/migrations/20261014120000_manager_assignments/` (idempotent, also creates `TeamPin`).
- Manager = `permissionProfile = 'project_manager'` (`canHoldAssignedPeople`). Administrator, Executive Manager and People Admin are already account-wide; Member and Accounting have no time oversight.
- Admin-only edits = `can(actor, 'edit_account_settings')` (only Administrators hold it), matching "Only Administrators can make people assignments".
- Archiving a person keeps their assignments (data stays; restore brings them back).

### 3.3 Phase 2: what changes, function by function (NOT built)
The risky part is widening who may see/edit whose time. Each item below must land with tests; today none
of them read `ManagerAssignment`.

| # | Function / file | Today | Phase 2 |
|---|---|---|---|
| 1 | `canActFor` / `ActForInput.targetIsManaged` (`modules/time/actingFor.ts`) | scoped actor may act for people on projects they PM | also true when target is in the actor's ManagerAssignment set |
| 2 | `mayActFor` (`lib/timesheetSubject.ts`) | `targetIsManaged` = shares a PM'd project | OR a `managerAssignment` row (managerId = actor, userId = target), one indexed lookup |
| 3 | `mayActForOnProject` (`lib/timesheetSubject.ts`) | limits a PM to projects they manage | assigned people: any project (Harvest: managed people *or* managed projects). Decide whether a non-PM'd project is allowed when the person is assigned (Harvest: yes) |
| 4 | `managedProjectIdsFor` (`lib/timesheetSubject.ts`) + its use in `app/timesheet/page.tsx` | project set for read-only/edit gating on a teammate's sheet | return null (no project limit) when viewing an assigned person |
| 5 | `listActablePeople` / `actablePeople` (`lib/timesheetSubject.ts`) | self + people on PM'd projects | union assigned people (Teammates switcher) |
| 6 | `app/timesheet/actions.ts` (log/start/stop/update/delete) and `app/expenses/actions.ts` (lines using `mayActForOnProject`) | follow 1–3 | no code change beyond 1–3, but add tests for assigned-person paths; INV-3 locks still apply |
| 7 | Reports scope: `app/reports/detailed/page.tsx`, `app/reports/detailed/export/route.ts`, `app/reports/detailed/expenses/page.tsx` + export, `modules/reports/detailedSql.ts`, `modules/reports/detailedTimeExport.ts` | `onlyUserId` = self unless `run_account_reports` | scope becomes `userIds = self ∪ assigned` (and PM'd projects) for managers; replace `onlyUserId` with a set |
| 8 | `app/reports/page.tsx` (summary Time report) | gated by `run_account_reports` for export | same scoped set |
| 9 | Approvals (none in Track2 yet; `approve_timesheets` capability is scoped for PMs) | n/a | when Pending approval is built, scope = assigned people ∪ PM'd projects; add "My assigned people" to its Everyone filter |
| 10 | `updatePersonBasicAction` (`app/team/actions.ts`) + `/team/[id]` gate (`manage_people` redirect) | `manage_people` only | allow a manager to edit First/Last name and Timezone of assigned people only (separate action), and view (read-only) their Assigned projects / Permissions |
| 11 | Team overview access (`app/team/page.tsx`) | any user with the team module | Harvest: admins + managers with assigned people (AC-TEAM-011) |

Built now (safe default only): the Team overview defaults a Project Manager with assigned people to the
"My assigned people" filter, with "Everyone" one click away. No access check changed.

## 4. Gap table (Track2 vs Harvest)

| Gap | Harvest | Track2 (before → now) | Files | Priority | Status |
|---|---|---|---|---|---|
| Assigned people model + admin UI | §3 | listed "people who share a project" → real assignments, admin picker + ✕ | `prisma/schema.prisma`, migration, `app/team/[id]/page.tsx`, `app/team/actions.ts`, `modules/team/teamOverview.ts` | P1 | **Built** |
| Manager default to assigned people | TO | none → default filter with Everyone option | `app/team/page.tsx` | P1 | **Built** |
| Everyone dropdown: My pins, roles | TO | access-level/type only → Everyone / My pins / roles / access level / type (optgroups) | `app/team/page.tsx`, `components/LiveFilters.tsx` | P1 | **Built** |
| Pin / Unpin | TO, PPg | none → `TeamPin` per viewer, pinned first | same + migration | P1 | **Built** |
| Archive from Actions; View archived people + Restore | TO, ADR | Security tab "active" checkbox; archived view mixed active+inactive → Archive item, archived-only list with Restore | `app/team/page.tsx`, `setPersonArchivedAction` | P1 | **Built** |
| Timer-running dot | TO | none → orange/gray dot | `app/team/page.tsx` | P2 | **Built** |
| Return to this week | TO | none → link | `app/team/page.tsx` | P2 | **Built** |
| Label: none for Members | TO | every row had a profile pill → Members unlabeled; others keep Track2's profile name (Harvest says "Admin"/"Manager", UNVERIFIED for the newer profiles) | `app/team/page.tsx` | P3 | **Built** |
| Phase 2 access for assigned people | §3.3 | none | see §3.3 | P1 (phase 2) | Open |
| Team overview only for admins + managers with assigned people | TO | any user with the module | `app/team/page.tsx` | P1 (with phase 2) | Open |
| Basic info: Employee ID, Roles, Timezone | PP | columns existed (`employeeId`, `roleTags`, `timezone`) but weren't editable → editable on Basic info | `components/PersonBasicForm.tsx`, `updatePersonBasicAction`, `modules/team/personBasic.ts` | P1 | **Built** (roles as comma-separated text; Harvest uses a tag picker, UNVERIFIED layout) |
| Delete person (no time/expenses) | ADR | none | `app/team/actions.ts` | P2 | Open (needs a cascade review: many relations) |
| Person page (week by day/project/task + timesheet) | PPg | name links to the profile; no person page | new `app/team/[id]/overview` | P2 | Open |
| Assigned projects type-ahead multi-select | PP, MULTI | single select + Add → "Find and select projects to assign…" multi-select grouped by client + "Assign projects" | `app/team/[id]/page.tsx`, `assignProjectToPersonAction` | P2 | **Built** |
| "Manages this project" All link; Member→Manager confirm when ticking Manages | PP, MULTI | per-row toggle only; no profile raise | `app/team/[id]/page.tsx`, `toggleManagesProjectAction` | P2 | Open (changes access: review with phase 2) |
| Invite flow (email invite, Resend invitation, Reset password) | ADD, PP | admin sets an initial password | `components/NewPersonForm.tsx`, Security tab | P2 | Open (needs email) |
| Notifications tab (own profile) | PP | none | — | P3 | Open |
| Photo / avatar | PP | initials only | — | P3 | Open |
| Custom permission profiles, Roles & Profiles bulk assign | ROLES | per-person overrides; Assignments tab lists profiles | `app/team/page.tsx` AssignmentsTab | P3 | Open |
| Rounding on Team overview totals | TO | unrounded | — | P3 | Open (UNVERIFIED whether Big Sea rounds) |

## 5. Notes
- `TeamPin` rows are per viewer and account-scoped; toggling re-checks the target is in the account (INV-5).
- Archive = `User.isActive = false` (sign-in and `requireUser()` already refuse inactive users). `archivedAt` stays reserved for migration-hidden users and is still excluded from every Team list.
- The running-timer query reads only `isRunning` rows (at most one per user by the partial unique index), and the week totals stay a DB `groupBy` (performance rules).

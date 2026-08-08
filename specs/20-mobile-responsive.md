# 20 — Mobile / responsive

## Why
The app was built desktop-first: a fixed **238px sidebar** always occupies the left edge, content uses
`px-8`, and data tables are wide. On a phone (≤640px) the sidebar eats most of the width, tables get
clipped or force the whole page to scroll sideways, and there's no way to reach nav without a mouse.
Track2 needs to be usable on a phone — the team checks invoices, timers, and approvals on the go.

## Breakpoints (Tailwind defaults)
`sm` 640 · `md` 768 · `lg` 1024. Treat **< lg** as "mobile/tablet" for the shell (sidebar collapses),
and **< sm** as the phone target for spacing/typography.

## Principles
1. **Nothing is unreachable.** Every desktop action has a mobile path.
2. **No horizontal page scroll.** The page body never scrolls sideways; wide tables scroll *inside their
   own container* (`overflow-x-auto`), not the whole page.
3. **Touch targets ≥ 40px.** Row actions, tabs, dropdowns are tappable.
4. **Progressive disclosure.** Secondary table columns may hide on small screens (`hidden sm:table-cell`);
   the primary column + key number always stay.

## Scope
### Shell (highest impact)
- Sidebar becomes an **off-canvas drawer** below `lg`: hidden by default, opened by a **hamburger** in a
  slim mobile top bar; a backdrop dismisses it; it closes on navigation. Static as today at `lg+`.
- Content padding responsive: `px-4 sm:px-8`. Main never scrolls horizontally (`overflow-x-hidden`);
  tables own their scroll.
- Top bar: global search collapses to an icon/expander on phones; timer + actions stay reachable.

### Tables
- Every list table sits in an `overflow-x-auto` container so it scrolls instead of clipping or breaking
  the layout. Consider hiding low-priority columns under `sm`.

### Forms & filters
- Filter bars wrap (`flex-wrap`, already mostly done); inputs go full-width on phones.
- Create/edit forms stack to one column under `sm`.

## Build order
1. **Responsive shell** — sidebar drawer + hamburger + responsive padding (this pass).
2. **Table overflow pass** — wrap the list tables (invoices, projects, clients, team, tasks, reports,
   expenses, timesheet) in `overflow-x-auto`.
3. **Column priority + form stacking** — hide secondary columns under `sm`; verify forms stack.
4. **Public/print invoice** — confirm the client-facing invoice reads on a phone.

## Acceptance
- **AC-MOB-001** At 375px, the sidebar is hidden; a hamburger opens it as a drawer over a backdrop; tapping a nav item navigates and closes it.
- **AC-MOB-002** No screen scrolls the page body horizontally; wide tables scroll within their own container.
- **AC-MOB-003** Home, Timesheet, Invoices (list + detail), Projects, Clients, Team, Reports are all usable at 375px — every primary action reachable.

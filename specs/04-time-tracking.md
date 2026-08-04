# 04 — Time Tracking

The daily-use surface. Must be fast, forgiving, and correct about rates and locking.

## Entering time — two modes

1. **Timer** — pick project + task, optional note, hit start. A live running entry (`timerStartedAt` set, `isRunning=true`). Stopping computes `minutes` from elapsed wall-clock, applies account `timeRounding`, clears `timerStartedAt`.
2. **Duration** — type a duration directly (`1.5`, `1:30`, `90m` all parse to 90 minutes) and save. No timer.

**One running timer per user (INV via unique index).** Starting a timer while another is running **stops the previous one first** (auto-stop, atomically, in one transaction).

## Views

- **Day view**: entries for a selected date, grouped, with a running total.
- **Week view (timesheet)**: rows = project/task, columns = 7 days, cells = editable durations; a weekly total and per-day totals. Week start follows `account.weekStartsOn`.
- Both views allow duplicate-last-entry and edit/delete of unlocked entries.

## Editing & deleting

- Allowed only when `lockState='open'` and the entry is not inside an approved timesheet.
- Editing project/task **re-runs rate resolution** and re-snapshots (only while `open`).
- Members edit only their own entries; managers/PMs per the permission matrix.

## Rounding (revised)

**Stored minutes are always exact.** Rounding is a **presentation/billing-summary** concern only: *"Time is never rounded in detailed time reports and timesheets"* (observed). Apply `account.timeRounding` when computing **summary time reports and invoice line-item quantities** — never when writing a time entry, and never in detailed reports or the timesheet grid. `nearest_6` = tenths of an hour (Harvest-style); ties round up.

Entry mode (live start/stop timer vs typed duration) follows the account **`timerMode`** preference; both write exact minutes.

## Timesheets & approval  *(gated by the `timesheet_approval` module — OFF at Big Sea)*

> Build this as a module, disabled by default. When off, there is no submit/approve/reopen flow and entries never enter the `approved` lock state (they go straight from `open` to `invoiced`). The rest of this section applies only when the module is enabled.

- A **Timesheet** row is the (user, weekly period) approval unit.
- Flow: `unsubmitted → submitted → approved`; an approver may `reopened` (back to editable) — which is a distinct status so history is preserved.
- **Submitting** freezes editing for that user on that period pending review (status `submitted`); a reopen restores editability.
- **Approving** sets every entry in the period to `lockState='approved'` and stamps `approvedTimesheetId`. Approved entries are immutable (**INV-3**) until reopened by an approver.
- Approval requires the approver to have rights over **every project** in the period (admin always; manager/PM only for their projects — otherwise the unapprovable rows are listed).
- Approval is independent of invoicing; an entry can be `approved` then later `invoiced`.

## Locking summary

| lockState | Editable? | Set by |
|---|---|---|
| `open` | yes (by owner/manager) | default |
| `approved` | no | timesheet approval |
| `invoiced` | no | added to a sent invoice |

`reopened` timesheet returns entries to `open`. Once `invoiced`, an entry never returns to `open` unless the invoice is deleted/voided while still `draft` (see [05](05-invoicing.md)).

## Acceptance criteria

- **AC-TIME-001** — *Given* no running timer, *when* a user starts one on Project A/Task Design, *then* an entry exists with `isRunning=true`, `timerStartedAt` set, `minutes=0`.
- **AC-TIME-002** — *Given* a running timer on A, *when* the user starts a new timer on B, *then* the A timer is stopped (minutes finalized) and only the B timer runs. Exactly one `isRunning` row exists for the user.
- **AC-TIME-003** — *Given* a running timer started 1h30m ago and rounding `none`, *when* stopped, *then* `minutes=90`.
- **AC-TIME-004** — *Given* rounding `nearest_15`, *when* a 52-minute timer stops, *then* `minutes=60`; a 7-minute timer → 0? No — ties/near round to nearest 15: 7 → 0, 8 → 15.
- **AC-TIME-005** — *Given* the duration input, *when* a user types `1:30`, `1.5`, or `90m`, *then* all persist as `minutes=90`.
- **AC-TIME-006** — *Given* an entry with `lockState='approved'`, *when* its owner edits it, *then* the edit is rejected.
- **AC-TIME-007** — *Given* an entry with `lockState='invoiced'`, *when* anyone edits or deletes it, *then* it is rejected (**INV-3**).
- **AC-TIME-008** — *Given* an `open` entry, *when* the owner changes its task to one with a different rate, *then* the entry's snapshotted `billableRateCents` updates to the newly resolved rate.
- **AC-TIME-009** — *Given* a week view, *when* the user enters `2` in Mon and `3` in Tue for a row, *then* the row total shows 5:00 and the week total updates accordingly.
- **AC-TIME-010** — *Given* a submitted timesheet, *when* the owner tries to add/edit an entry in that period, *then* it is rejected until reopened.
- **AC-TIME-011** — *Given* a submitted timesheet with projects the approver manages, *when* approved, *then* all entries in the period become `lockState='approved'` and carry `approvedTimesheetId`.
- **AC-TIME-012** — *Given* an approved timesheet, *when* an approver reopens it, *then* its entries return to `lockState='open'` and become editable.
- **AC-TIME-013** — *Given* a manager who lacks rights on one project in a submitted period, *when* they attempt approval, *then* approval is blocked and the un-approvable rows are named.
- **AC-TIME-014** — *Given* two concurrent "start timer" requests for the same user, *when* both hit the server, *then* exactly one timer ends up running (transactional + unique index; no duplicate running timers).
- **AC-TIME-015** — *Given* a running timer, *when* the user reloads the app hours later, *then* elapsed time is computed from `timerStartedAt` (server truth), not client clock.

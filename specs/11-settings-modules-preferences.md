# 11 — Settings: Modules, Preferences, Billing

Account-level configuration. Structure observed under **Settings** (sub-nav: Billing · Preferences · Modules · Sign in security · Import/Export · Bulk actions).

## Modules (feature flags)

Every major feature is toggleable. The app must gate UI and services on these flags.

| Module | Controls | Big Sea |
|---|---|---|
| `time_tracking` | Timesheet, timers | On |
| `expense_tracking` | Expenses ([09-expenses](09-expenses.md)) | On |
| `timesheet_approval` | Submit/approve/reopen workflow ([04](04-time-tracking.md)) | **Off** |
| `team` | Team/people management | On |
| `invoices` | Invoices, recurring, retainers | On |
| `estimates` | Estimates ([06](06-estimates.md)) | **Off** |
| `client_dashboard` | Client-facing portal | On |
| `activity_log` | Activity/audit report (Premium) | **Off** |

- **AC-MOD-001** — *Given* `estimates=off`, *when* a user navigates to the estimates route, *then* it 404s / is hidden from nav (matches live behavior).
- **AC-MOD-002** — *Given* `timesheet_approval=off`, *when* timesheets are used, *then* no submit/approve controls appear and entries never enter `approved` lock state.

## Preferences (account defaults)

Full field set observed (Settings → Preferences):

| Field | Example (Big Sea) | Notes |
|---|---|---|
| Company name | Big Sea | |
| Account Owner | one person | Billing owner; single designated user |
| Timezone | Eastern Time (US & Canada) | Account default |
| Fiscal year | Starts in January | For fiscal reporting |
| Start week on | Monday | Timesheet/week grid start |
| Default capacity | 35 hours/week | Per-person overridable |
| Timesheet deadline | Friday at 5:00pm | |
| Timesheet reminders | 1h before & 24h after deadline, to anyone under 50% of capacity | Automated nudges |
| Time entry notes | Optional (Premium) | Optional vs Required |
| Time rounding | No rounding | **Summary/invoice layer only** — never rounds stored minutes, detailed reports, or timesheets |
| Date format | MM/DD/YYYY | |
| Time format | 12-hour clock | 12h/24h |
| Time display | HH:MM | HH:MM vs decimal (1.5) |
| Timer mode | Track time via duration | duration vs start/stop |
| Calendar view | Disabled | (new feature) |
| Currency | USD | Base currency |
| Currency format | $345.00 | |
| Number format | 1,234.56 | |
| Expense reimbursement | Do not allow reimbursement requests | |

- **AC-PREF-001** — *Given* `startWeekOn=Monday`, *when* the week timesheet renders, *then* columns run Mon→Sun.
- **AC-PREF-002** — *Given* `timeDisplay=HH:MM`, *when* durations render, *then* 90 min shows as `1:30`; *given* `decimal`, it shows `1.50`.
- **AC-PREF-003** — *Given* `timeRounding=nearest_15`, *when* a detailed time report or timesheet is viewed, *then* raw minutes are shown unrounded; only summary reports and invoices apply the rounding.
- **AC-PREF-004** — *Given* the timesheet reminder rule, *when* the deadline passes and a person tracked < 50% capacity, *then* a reminder is sent 24h after (and 1h before).

## Billing (reference only — not building the payment system)

Plan + seats, payment method, receipt recipients, web address (subdomain), account-created date. Out of scope to implement; keep a minimal account/plan record.

## Import/Export & Bulk actions

Harvest exposes CSV import/export for clients, projects, tasks, people, time, invoices, and bulk actions across records. For migration off Harvest this matters: build **CSV import** for the core entities so Big Sea can move historical data in. See migration note in [00-overview](00-overview.md).

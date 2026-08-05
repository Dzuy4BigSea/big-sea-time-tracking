# 01 — Data Model

The authoritative data model. `prisma/schema.prisma` must match this file; the validation agent diffs the two.

## Conventions

- All ids are `cuid`/`uuid` strings.
- Every tenant-owned row has `accountId` (FK → Account) and is filtered by it on every query (**INV-5**).
- Timestamps: `createdAt`, `updatedAt` (UTC) on every table.
- Money: integer **minor units** (cents) in a named column suffixed `Cents`, always paired with a `currency` (ISO 4217) at the invoice level.
- Durations: integer **minutes** (`minutes` column); decimal hours are presentation-only.
- Soft delete via `archivedAt` (nullable) for Client/Project/Task/User; hard delete only where noted.

## Entities

### Account
The tenant / workspace.
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| name | string | Company name |
| accountOwnerUserId | FK → User | Single designated owner (billing owner) |
| baseCurrency | string | ISO 4217, default `USD`. Cost is always in account currency |
| currencyFormat | string | e.g. `$345.00` |
| numberFormat | string | e.g. `1,234.56` |
| timezone | string | IANA account default |
| fiscalYearStartMonth | int | 1–12 (Big Sea: January) |
| weekStartsOn | enum(`sunday`,`monday`) | Timesheet week start |
| defaultCapacityHours | decimal | Default weekly capacity (Big Sea: 35) |
| timesheetDeadlineDay | enum(`mon`..`sun`) | e.g. Friday |
| timesheetDeadlineTime | string | e.g. `17:00` |
| timesheetReminderRule | json | e.g. {before:1h, after:24h, ifUnderCapacityPct:50} |
| timeEntryNotes | enum(`optional`,`required`) | Premium |
| timeRounding | enum(`none`,`nearest_1`,`nearest_5`,`nearest_6`,`nearest_10`,`nearest_15`) | **Summary/invoice-layer only** — never applied to stored minutes or detailed reports (see [04](04-time-tracking.md)) |
| dateFormat | string | e.g. `MM/DD/YYYY` |
| timeFormatClock | enum(`12h`,`24h`) | |
| timeDisplay | enum(`hh_mm`,`decimal`) | `HH:MM` vs `1.5` |
| timerMode | enum(`duration`,`start_stop`) | Account default entry mode (Big Sea: duration) |
| expenseReimbursement | enum(`disabled`,`allowed`) | Reimbursement requests |
| invoiceNumberSeq | int | Monotonic counter for invoice numbers |
| estimateNumberSeq | int | Monotonic counter for estimate numbers |
| createdAt/updatedAt | datetime | |

### Module (feature flags)
Harvest is modular. One row (or JSON) per account toggling: `time_tracking`, `expense_tracking`, `timesheet_approval`, `team`, `invoices`, `estimates`, `client_dashboard`, `activity_log`. UI and service layer must gate features on these. Big Sea: time/expense/team/invoices/client_dashboard **on**; approval/estimates/activity_log **off**.

### User
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId | FK | |
| email | string | Unique per account |
| passwordHash | string | Argon2/bcrypt |
| firstName / lastName | string | |
| employeeId | string? | Optional external identifier |
| type | enum(`employee`,`contractor`) | Drives the Contractor report |
| permissionProfile | enum(`member`,`project_manager`,`people_admin`,`accounting`,`executive_manager`,`administrator`) | Base profile — see [02](02-auth-accounts.md) |
| permissionOverrides | json? | Granular capability toggles layered on the profile (profiles are customizable) |
| roleTags | string[] | Descriptive tags (Designer, Biz Dev) — **not** permissions |
| departments | string[] | |
| capacityHoursPerWeek | decimal? | Defaults to account `defaultCapacityHours` |
| timezone | string? | Per-person; defaults to account tz |
| isActive | bool | Deactivated users can't log in but keep history |
| archivedAt | datetime? | |

Rates are **not** columns here — see §Rates (effective-dated tables) below.

### PersonBillableRate / PersonCostRate  *(effective-dated)*
Two tables, same shape. A person's rate is a **history**, not a single value.
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / userId | FK | |
| hourlyRateCents | int | |
| startDate | date? | null = "all prior" |
| endDate | date? | null = "all future" |
| createdAt/updatedAt | datetime | |
Constraint: for a given user, effective ranges must not overlap. Resolution picks the row whose [startDate, endDate] contains the time entry's `spentDate`. **Cost rate visible to Administrators only; billable rate to Admins + permitted Managers.**

### Client
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId | FK | |
| name | string | |
| currency | string | Default currency for this client's invoices |
| address | text? | |
| isActive | bool | |
| archivedAt | datetime? | |

### ClientContact
A client has **many** contacts; one or more flagged as invoice recipient.
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / clientId | FK | |
| firstName / lastName | string | |
| title | string? | e.g. "Director of Public Affairs" |
| email | string? | |
| phoneOffice / phoneMobile | string? | |
| isInvoiceRecipient | bool | Shown as "(invoices)" in UI |

### Project
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId | FK | |
| clientId | FK | |
| name | string | |
| code | string? | Short code |
| projectType | enum(`time_and_materials`,`fixed_fee`,`non_billable`) | Level 1 |
| billableRateMethod | enum(`none`,`project`,`person`,`task`)? | Level 2 — only when `time_and_materials`. `none` = "No billable rate" |
| projectHourlyRateCents | int? | Used when `billableRateMethod='project'` (effective-dated variant optional) |
| projectFeesCents | int? | Used when `projectType='fixed_fee'` ("amount you plan to invoice") |
| billingCurrency | string? | "Same as client" by default; costs always in account currency |
| budgetMethod | enum(`none`,`hours_total`,`hours_per_task`,`hours_per_person`,`fee_total`,`cost_total`) | |
| budgetValue | int? | Interpretation depends on budgetMethod (minutes or cents) |
| budgetResetsMonthly | bool | Rolling monthly budget |
| budgetAlertPercent | int? | Notify when spent ≥ this % |
| isBillable | bool | |
| startsOn / endsOn | date? | |
| notes | text? | |
| isActive | bool | |
| archivedAt | datetime? | |

### Task (global list)
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId | FK | |
| name | string | e.g. "Design" |
| defaultBillable | bool | |
| defaultHourlyRateCents | int? | Default billable rate; used when project `billableRateMethod='task'` |
| autoAddToNewProjects | bool | `true` = "Common task" (auto-added to every new project); `false` = "Other task" (added manually) |
| isActive | bool | |
| archivedAt | datetime? | |

### ProjectTaskAssignment
Which tasks apply to a project, with per-project overrides.
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / projectId / taskId | FK | Unique (projectId, taskId) |
| billable | bool | Overrides task default for this project |
| hourlyRateCents | int? | Overrides task rate when `by_task_rate` |
| isActive | bool | |

### ProjectUserAssignment
Who can log time on a project, with per-person rate.
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / projectId / userId | FK | Unique (projectId, userId) |
| hourlyRateCents | int? | Overrides person default when `by_person_rate` |
| isProjectManager | bool | Grants PM powers scoped to this project |
| isActive | bool | |

### TimeEntry
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / userId / projectId / taskId | FK | |
| spentDate | date | The day the work is attributed to |
| minutes | int | Stored duration |
| notes | text? | |
| isBillable | bool | Resolved from project type / task assignment |
| billableRateCents | int? | Resolved via effective-dated rate matched on `spentDate` (null if non-billable / no rate set). May be re-derived until locked — see [03](03-clients-projects-tasks.md) |
| timerStartedAt | datetime? | Non-null while timer running |
| isRunning | bool | Derived: timerStartedAt not null |
| lockState | enum(`open`,`approved`,`invoiced`) | See locking rules |
| invoiceLineItemId | FK? | Set when pulled onto an invoice (**INV-4**) |
| approvedTimesheetId | FK? | Set when inside an approved period |

Constraint: **at most one** row per user with `isRunning = true` (partial unique index).

### Timesheet (approval period)
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / userId | FK | |
| periodStart / periodEnd | date | Weekly period |
| status | enum(`unsubmitted`,`submitted`,`approved`,`reopened`) | |
| submittedAt / approvedAt | datetime? | |
| approvedByUserId | FK? | |

### Invoice
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / clientId | FK | |
| number | string | Unique per account (**INV-6**) |
| status | enum(`draft`,`open`,`paid`,`closed`,`written_off`) | State machine |
| currency | string | ISO 4217 |
| issueDate | date? | Set on send |
| dueDate | date? | Computed from paymentTerm |
| paymentTerm | enum(`due_on_receipt`,`net_15`,`net_30`,`net_45`,`net_60`,`custom`) | |
| subject | string? | |
| poNumber | string? | |
| notes / terms | text? | |
| subtotalCents | int | Sum of line items |
| discountPercent | decimal? | |
| discountCents | int | Computed |
| tax1Name / tax1Percent | string?/decimal? | |
| tax2Name / tax2Percent | string?/decimal? | |
| taxCents | int | Computed |
| totalCents | int | subtotal − discount + tax |
| paidCents | int | Sum of payments |
| dueCents | int | total − paid (computed) |
| sentAt / lastViewedAt | datetime? | |
| publicToken | string? | For shareable client link |
| createdFromEstimateId | FK? | |

### InvoiceLineItem
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / invoiceId | FK | |
| kind | enum(`time`,`expense`,`free_form`,`flat`) | source of the line |
| itemTypeId | FK → ItemType | Configurable revenue category (observed) — defaults: `Service` for time/fees, `Product` for expenses |
| description | string | |
| quantity | decimal | Hours or count |
| unitPriceCents | int | |
| amountCents | int | quantity × unitPrice, rounded |
| taxable | bool | Whether tax1/tax2 apply |
| sortOrder | int | |

TimeEntries link to a line item via `TimeEntry.invoiceLineItemId`; a `time` line item may aggregate many entries (grouped by task/person/day per invoice settings).

### ItemType
Configurable invoice line-item categories (for revenue categorization / accounting sync). Observed at Big Sea: ~20 (Creative & Copywriting, Hosting, Media Buy, Web Design & Development, Discount, Revenue Share, …).
| Field | Type | Notes |
|---|---|---|
| id / accountId | | |
| name | string | |
| isSystemDefault | bool | `Service` (default for billable hours/fees) and `Product` (default for expenses) can't be deleted |
| createdAt/updatedAt | datetime | |

### InvoiceMessageTemplate
Templated emails for sending invoices/estimates. Three kinds; support variables (`%invoice_client%`, `%invoice_subject%`, `%invoice_url%`, `%company_name%`, …).
| Field | Type | Notes |
|---|---|---|
| id / accountId | | |
| kind | enum(`invoice`,`reminder`,`thank_you`) | |
| subject / body | string/text | With variable interpolation |

### SenderAddress
Configurable "send messages as" addresses (e.g. `invoices@bigseadesign.com`).
| Field | Type | Notes |
|---|---|---|
| id / accountId | | |
| name / email | string | |
| isDefault | bool | |

### InvoiceAppearance
Account-level invoice branding (Configure → Appearance). 1:1 with Account. Drives both the PDF and the client-facing view.
| Field | Type | Notes |
|---|---|---|
| id / accountId | | 1:1 |
| logoFileUrl | string? | Top-left logo |
| bannerFileUrl | string? | Bottom banner |
| useCompanyBranding | bool | vs Harvest-style default |
| brandColor | string | hex (Big Sea `#004348`) |
| backgroundColor | string | hex |
| showDocumentTitle | bool | |
| documentTitle | string | e.g. "INVOICE" |
| snailMailFriendly | bool | client address left, for envelope windows |
| showItemTypeCol / showDescriptionCol / showQuantityCol / showUnitPriceCol / showAmountCol | bool | which columns render |

### InvoiceLabels
Customizable/localizable label map for invoice rendering (Configure → Field labels). Store as JSON (or key/value rows) keyed by field: `documentTitle, from, for, invoiceId, poNumber, issueDate, dueDate, uponReceipt, netDays, tax, tax2, discount, subject, itemType, description, quantity, unitPrice, amount, subtotal, amountDue, totalHours, notes, pdfPageNumbering, fileAttachments`. Defaults provided; renderer reads from here.

### Payment
| Field | Type | Notes |
|---|---|---|
| id | string | PK |
| accountId / invoiceId | FK | |
| amountCents | int | > 0 |
| paidOn | date | |
| method | enum(`cash`,`check`,`bank_transfer`,`card`,`other`) | |
| note | text? | |

### Estimate
Mirrors Invoice with `status` enum(`draft`,`sent`,`accepted`,`declined`) and its own line items table `EstimateLineItem` (same shape as InvoiceLineItem, no `time` linkage). Gated by the `estimates` module (off at Big Sea). See [06](06-estimates.md).

### ExpenseCategory
| Field | Type | Notes |
|---|---|---|
| id / accountId | | |
| name | string | e.g. "WP Premium Plugin", "Development Contractor" |
| unitName | string? | Optional unit (e.g. mile) for unit-based categories |
| unitPriceCents | int? | For unit-based categories |
| isActive | bool | |

### Expense
| Field | Type | Notes |
|---|---|---|
| id / accountId / userId / projectId | FK | |
| categoryId | FK → ExpenseCategory | |
| spentDate | date | |
| totalCents | int | Amount (or units × unitPrice) |
| markupPercent | decimal? | Optional markup applied when invoiced |
| notes | text? | |
| isBillable | bool | |
| receiptFileId | FK? | Attached receipt image/PDF |
| lockState | enum(`open`,`invoiced`) | Locked when invoiced |
| invoiceLineItemId | FK? | Set when added to an invoice (`kind='expense'`) |

### RecurringInvoiceProfile
| Field | Type | Notes |
|---|---|---|
| id / accountId / clientId | FK | |
| subject | string | |
| frequency | enum(`weekly`,`monthly`,`quarterly`,`yearly`,`custom`) | |
| intervalCount | int | e.g. every 1 month |
| nextIssueDate | date? | null while paused |
| status | enum(`active`,`paused`) | |
| amountCents | int | Cached total for the list view |
| templateLineItems | json | Line items cloned into each generated invoice |
| paymentTerm / notes / tax… | — | Same billing fields as Invoice |
Generation job creates a `draft` (or auto-sent) Invoice on `nextIssueDate`, then advances the date.

### Retainer
Prepaid balance a client draws down.
| Field | Type | Notes |
|---|---|---|
| id / accountId / clientId | FK | |
| projectId | FK? | null = "All projects" |
| depositCents | int | Amount prepaid |
| balanceCents | int | Remaining (deposit − drawn) |
| drawnCents | int | Amount consumed by invoices |
| status | enum(`ongoing`,`archived`) | |
Invoices applied against a retainer reduce `balanceCents` / increase `drawnCents`. Retainer deposits are excluded from "total paid" revenue metrics.

### AuditLog
| Field | Type | Notes |
|---|---|---|
| id / accountId / actorUserId | | |
| entityType / entityId | string | |
| action | enum(`create`,`update`,`delete`,`state_change`) | |
| before / after | json? | |
| createdAt | datetime | |

## Relationships (summary)

- Account 1—* User, Client, Task, Invoice, Estimate
- Client 1—* Project, Invoice, Estimate
- Project 1—* ProjectTaskAssignment, ProjectUserAssignment, TimeEntry
- Task 1—* ProjectTaskAssignment
- User 1—* TimeEntry, Timesheet
- Invoice 1—* InvoiceLineItem, Payment
- InvoiceLineItem 1—* TimeEntry (via invoiceLineItemId)

## Extension points (kept, not built this phase)

- **Client dashboard / portal** — client-facing view of invoices & (optionally) time. Module is **on** at Big Sea; invoice `publicToken` already supports link-based access. Build in P1.
- **Integrations** — Xero (invoice sync), Stripe (online payments), Google (team/calendar import), Forecast (scheduling). Keep a generic integration seam; don't implement in phase 1.
- **E-invoicing** — UBL export toggle on invoices.

> Expenses, Recurring invoices, and Retainers are now **modeled above** (moved in-scope after observing they're in active use).

## Acceptance criteria

- **AC-DATA-001** — *Given* the Prisma schema, *when* the validation agent diffs it against this file, *then* every entity, field, type, and enum value matches (names may be camelCase in schema).
- **AC-DATA-002** — *Given* any tenant-owned query, *when* executed, *then* it includes an `accountId` filter (enforced by a repository wrapper; verified by test that a cross-account id returns null). (**INV-5**)
- **AC-DATA-003** — *Given* a TimeEntry, *when* two rows for the same user both set `isRunning=true`, *then* the DB rejects the second write (partial unique index). 
- **AC-DATA-004** — *Given* an Invoice, *when* `totalCents` is recomputed from line items/discount/tax, *then* it equals the stored value (no drift).
- **AC-DATA-005** — *Given* any monetary column, *when* inspected, *then* its type is integer (no float/decimal money columns). (**INV-1**)

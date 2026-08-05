/**
 * Deterministic seed for Track2.
 *
 * Per specs/00-overview.md §5: two accounts (for tenant-isolation tests),
 * users across the 6 permission profiles, item types, tasks, clients + contacts,
 * projects covering each billing configuration, time entries with resolved rates,
 * a sent invoice + partial payment, a draft invoice, an expense, a recurring
 * profile, and a retainer.
 *
 * Fully deterministic: explicit ids + fixed dates, no randomness — so QA runs are
 * reproducible. Re-running deletes the two demo accounts (cascade) and recreates.
 *
 * Run: `npm run db:seed` (requires a migrated Postgres — `npm run prisma:migrate`).
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// One shared hash for all demo users. Login: password "password123".
const passwordHash = bcrypt.hashSync('password123', 10)

/** Date-only helper (UTC midnight). */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** Timestamp helper. */
const t = (iso: string) => new Date(iso)

// Money helpers — everything is integer cents.
const USD = (dollars: number) => Math.round(dollars * 100)

const ACCOUNT_A = 'acc_demo'
const ACCOUNT_B = 'acc_globex'

async function main() {
  // Idempotent: remove demo accounts; cascade wipes all children.
  await prisma.account.deleteMany({ where: { id: { in: [ACCOUNT_A, ACCOUNT_B] } } })

  await seedAccountA()
  await seedAccountB()

  console.log('Seed complete: accounts', ACCOUNT_A, '+', ACCOUNT_B)
}

/** The primary demo account, modeled on Big Sea's configuration. */
async function seedAccountA() {
  // 1. Account + modules (owner set after users exist to break the FK cycle).
  await prisma.account.create({
    data: {
      id: ACCOUNT_A,
      name: 'Big Sea (demo)',
      baseCurrency: 'USD',
      timezone: 'America/New_York',
      fiscalYearStartMonth: 1,
      weekStartsOn: 'monday',
      defaultCapacityHours: 35,
      timesheetDeadlineDay: 'fri',
      timesheetDeadlineTime: '17:00',
      timesheetReminderRule: { beforeHours: 1, afterHours: 24, ifUnderCapacityPct: 50 },
      timeEntryNotes: 'optional',
      timeRounding: 'none',
      dateFormat: 'MM/DD/YYYY',
      timeFormatClock: 'h12',
      timeDisplay: 'hh_mm',
      timerMode: 'duration',
      expenseReimbursement: 'disabled',
      invoiceNumberSeq: 1001, // last issued; next send → 1002
      estimateNumberSeq: 1000,
      module: {
        create: {
          timeTracking: true,
          expenseTracking: true,
          timesheetApproval: false, // off at Big Sea
          team: true,
          invoices: true,
          estimates: false, // off at Big Sea
          clientDashboard: true,
          activityLog: false,
        },
      },
    },
  })

  // 2. Users — one per permission profile (+ a contractor member).
  const users: Array<{
    id: string
    firstName: string
    lastName: string
    profile:
      | 'administrator'
      | 'executive_manager'
      | 'project_manager'
      | 'accounting'
      | 'people_admin'
      | 'member'
    type?: 'employee' | 'contractor'
    email?: string
    billable?: number
    cost?: number
  }> = [
    // Real Big Sea login. Password defaults to the shared demo password unless
    // SEED_DZUY_PASSWORD is set (see override after this loop) — no plaintext in the repo.
    { id: 'usr_dzuy', firstName: 'Dzuy', lastName: 'Nguyen', profile: 'administrator', email: 'dzuy@bigsea.co', billable: 195, cost: 95 },
    { id: 'usr_alice', firstName: 'Alice', lastName: 'Admin', profile: 'administrator', billable: 195, cost: 95 },
    { id: 'usr_bob', firstName: 'Bob', lastName: 'Exec', profile: 'executive_manager', billable: 175, cost: 90 },
    { id: 'usr_carol', firstName: 'Carol', lastName: 'Pm', profile: 'project_manager', billable: 150, cost: 80 },
    { id: 'usr_dave', firstName: 'Dave', lastName: 'Books', profile: 'accounting' },
    { id: 'usr_erin', firstName: 'Erin', lastName: 'People', profile: 'people_admin' },
    { id: 'usr_frank', firstName: 'Frank', lastName: 'Member', profile: 'member', billable: 120, cost: 60 },
    { id: 'usr_grace', firstName: 'Grace', lastName: 'Contractor', profile: 'member', type: 'contractor', billable: 110, cost: 55 },
  ]

  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id,
        accountId: ACCOUNT_A,
        email: u.email ?? `${u.firstName.toLowerCase()}@bigsea.demo`,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        type: u.type ?? 'employee',
        permissionProfile: u.profile,
        capacityHoursPerWeek: 35,
        timezone: 'America/New_York',
      },
    })
    // Effective-dated rates (current, open-ended) where the person is billable.
    if (u.billable != null) {
      await prisma.personBillableRate.create({
        data: { accountId: ACCOUNT_A, userId: u.id, hourlyRateCents: USD(u.billable), startDate: d('2026-01-01') },
      })
    }
    if (u.cost != null) {
      await prisma.personCostRate.create({
        data: { accountId: ACCOUNT_A, userId: u.id, hourlyRateCents: USD(u.cost), startDate: d('2026-01-01') },
      })
    }
  }

  // Optional: set Dzuy's real password from an env var (never committed to the repo).
  // Run: `SEED_DZUY_PASSWORD='…' npm run db:seed`. Otherwise defaults to the demo password.
  if (process.env.SEED_DZUY_PASSWORD) {
    await prisma.user.update({
      where: { id: 'usr_dzuy' },
      data: { passwordHash: bcrypt.hashSync(process.env.SEED_DZUY_PASSWORD, 10) },
    })
  }

  // A historical billable rate for Alice, to exercise effective-dated resolution.
  await prisma.personBillableRate.create({
    data: { accountId: ACCOUNT_A, userId: 'usr_alice', hourlyRateCents: USD(175), endDate: d('2025-12-31') },
  })

  // Owner (breaks the account↔user cycle now that users exist).
  await prisma.account.update({ where: { id: ACCOUNT_A }, data: { accountOwnerUserId: 'usr_alice' } })

  // 3. Item types (Service/Product are system defaults; cannot be deleted).
  await prisma.itemType.createMany({
    data: [
      { id: 'it_service', accountId: ACCOUNT_A, name: 'Service', isSystemDefault: true },
      { id: 'it_product', accountId: ACCOUNT_A, name: 'Product', isSystemDefault: true },
      { id: 'it_design', accountId: ACCOUNT_A, name: 'Creative & Copywriting' },
      { id: 'it_dev', accountId: ACCOUNT_A, name: 'Web Design & Development' },
      { id: 'it_hosting', accountId: ACCOUNT_A, name: 'Hosting' },
    ],
  })

  // 4. Global tasks — "Common" (auto-added to new projects) vs "Other".
  await prisma.task.createMany({
    data: [
      { id: 'task_design', accountId: ACCOUNT_A, name: 'Design', defaultBillable: true, defaultHourlyRateCents: USD(160), autoAddToNewProjects: true },
      { id: 'task_dev', accountId: ACCOUNT_A, name: 'Development', defaultBillable: true, defaultHourlyRateCents: USD(160), autoAddToNewProjects: true },
      { id: 'task_pm', accountId: ACCOUNT_A, name: 'Project Management', defaultBillable: true, defaultHourlyRateCents: USD(160), autoAddToNewProjects: true },
      { id: 'task_internal', accountId: ACCOUNT_A, name: 'Internal / Admin', defaultBillable: false, defaultHourlyRateCents: 0, autoAddToNewProjects: false },
    ],
  })

  // 5. Clients + contacts.
  await prisma.client.create({
    data: {
      id: 'cli_acme',
      accountId: ACCOUNT_A,
      name: 'Acme Corporation',
      currency: 'USD',
      address: '100 Market St\nSan Francisco, CA 94103',
      contacts: {
        create: [
          { accountId: ACCOUNT_A, firstName: 'Ada', lastName: 'Payable', title: 'AP', email: 'ap@acme.demo', isInvoiceRecipient: true },
          { accountId: ACCOUNT_A, firstName: 'Cyrus', lastName: 'Exec', title: 'CEO', email: 'ceo@acme.demo' },
        ],
      },
    },
  })
  await prisma.client.create({
    data: {
      id: 'cli_northwind',
      accountId: ACCOUNT_A,
      name: 'Northwind Traders',
      currency: 'USD',
      contacts: {
        create: [{ accountId: ACCOUNT_A, firstName: 'Nan', lastName: 'Wind', email: 'billing@northwind.demo', isInvoiceRecipient: true }],
      },
    },
  })

  // 6. Projects — one per billing configuration (specs/03).
  // (a) Time & Materials, project billable rate.
  await prisma.project.create({
    data: {
      id: 'prj_acme_web',
      accountId: ACCOUNT_A,
      clientId: 'cli_acme',
      name: 'Website Redesign',
      code: 'ACME-WEB',
      projectType: 'time_and_materials',
      billableRateMethod: 'project',
      projectHourlyRateCents: USD(150),
      budgetMethod: 'hours_total',
      budgetValue: 80 * 60, // 80h in minutes
      budgetAlertPercent: 80,
      startsOn: d('2026-06-01'),
    },
  })
  // (b) Time & Materials, person billable rate (monthly-reset budget).
  await prisma.project.create({
    data: {
      id: 'prj_acme_retainer',
      accountId: ACCOUNT_A,
      clientId: 'cli_acme',
      name: 'Monthly Support Retainer',
      code: 'ACME-RET',
      projectType: 'time_and_materials',
      billableRateMethod: 'person',
      budgetMethod: 'hours_total',
      budgetValue: 40 * 60,
      budgetResetsMonthly: true,
    },
  })
  // (c) Time & Materials, task billable rate.
  await prisma.project.create({
    data: {
      id: 'prj_nw_brand',
      accountId: ACCOUNT_A,
      clientId: 'cli_northwind',
      name: 'Brand System',
      code: 'NW-BRAND',
      projectType: 'time_and_materials',
      billableRateMethod: 'task',
    },
  })
  // (d) Fixed Fee.
  await prisma.project.create({
    data: {
      id: 'prj_nw_logo',
      accountId: ACCOUNT_A,
      clientId: 'cli_northwind',
      name: 'Logo Package',
      code: 'NW-LOGO',
      projectType: 'fixed_fee',
      projectFeesCents: USD(5000),
      budgetMethod: 'fee_total',
      budgetValue: USD(5000),
    },
  })
  // (e) Non-Billable.
  await prisma.project.create({
    data: {
      id: 'prj_acme_internal',
      accountId: ACCOUNT_A,
      clientId: 'cli_acme',
      name: 'Internal QA',
      code: 'ACME-INT',
      projectType: 'non_billable',
      isBillable: false,
    },
  })

  // 7. Assignments — tasks (Common tasks auto-add) + users, with overrides.
  const commonTasks = ['task_design', 'task_dev', 'task_pm']
  for (const projectId of ['prj_acme_web', 'prj_acme_retainer', 'prj_nw_brand', 'prj_nw_logo', 'prj_acme_internal']) {
    for (const taskId of commonTasks) {
      await prisma.projectTaskAssignment.create({ data: { accountId: ACCOUNT_A, projectId, taskId } })
    }
  }
  await prisma.projectTaskAssignment.create({ data: { accountId: ACCOUNT_A, projectId: 'prj_acme_internal', taskId: 'task_internal', billable: false } })
  // Task-rate override on the task-rate project (Design billed at $180/h here).
  await prisma.projectTaskAssignment.update({
    where: { projectId_taskId: { projectId: 'prj_nw_brand', taskId: 'task_design' } },
    data: { hourlyRateCents: USD(180) },
  })

  await prisma.projectUserAssignment.createMany({
    data: [
      { accountId: ACCOUNT_A, projectId: 'prj_acme_web', userId: 'usr_frank' },
      { accountId: ACCOUNT_A, projectId: 'prj_acme_web', userId: 'usr_carol', isProjectManager: true },
      { accountId: ACCOUNT_A, projectId: 'prj_acme_web', userId: 'usr_grace' },
      // person-rate project: Frank has a per-project override of $130/h.
      { accountId: ACCOUNT_A, projectId: 'prj_acme_retainer', userId: 'usr_frank', hourlyRateCents: USD(130) },
      { accountId: ACCOUNT_A, projectId: 'prj_nw_brand', userId: 'usr_bob' },
      { accountId: ACCOUNT_A, projectId: 'prj_acme_internal', userId: 'usr_frank' },
    ],
  })

  // 8. Time entries — billableRateCents shown as it would resolve (specs/03).
  await prisma.timeEntry.createMany({
    data: [
      // project-rate → $150/h regardless of person
      { id: 'te1', accountId: ACCOUNT_A, userId: 'usr_frank', projectId: 'prj_acme_web', taskId: 'task_design', spentDate: d('2026-07-02'), minutes: 90, notes: 'Homepage hero', isBillable: true, billableRateCents: USD(150) },
      { id: 'te2', accountId: ACCOUNT_A, userId: 'usr_carol', projectId: 'prj_acme_web', taskId: 'task_dev', spentDate: d('2026-07-02'), minutes: 120, notes: 'Nav build', isBillable: true, billableRateCents: USD(150) },
      { id: 'te3', accountId: ACCOUNT_A, userId: 'usr_grace', projectId: 'prj_acme_web', taskId: 'task_dev', spentDate: d('2026-07-07'), minutes: 45, isBillable: true, billableRateCents: USD(150) },
      // person-rate → Frank's per-project override $130/h
      { id: 'te4', accountId: ACCOUNT_A, userId: 'usr_frank', projectId: 'prj_acme_retainer', taskId: 'task_pm', spentDate: d('2026-07-03'), minutes: 60, isBillable: true, billableRateCents: USD(130) },
      // task-rate → Design override $180/h
      { id: 'te5', accountId: ACCOUNT_A, userId: 'usr_bob', projectId: 'prj_nw_brand', taskId: 'task_design', spentDate: d('2026-07-06'), minutes: 180, isBillable: true, billableRateCents: USD(180) },
      // non-billable project → no rate
      { id: 'te6', accountId: ACCOUNT_A, userId: 'usr_frank', projectId: 'prj_acme_internal', taskId: 'task_internal', spentDate: d('2026-07-06'), minutes: 30, isBillable: false },
    ],
  })
  // A running timer for Frank (exercises the one-running-timer invariant).
  await prisma.timeEntry.create({
    data: { id: 'te_running', accountId: ACCOUNT_A, userId: 'usr_frank', projectId: 'prj_acme_web', taskId: 'task_dev', spentDate: d('2026-07-10'), minutes: 0, isBillable: true, billableRateCents: USD(150), isRunning: true, timerStartedAt: t('2026-07-10T14:30:00.000Z') },
  })

  // 9. Sent invoice (Acme) grouped by task, with a partial payment.
  //    te1 (Design 1.5h) + te2 (Dev 2h) at $150 → $52,500.
  await prisma.invoice.create({
    data: {
      id: 'inv_1001',
      accountId: ACCOUNT_A,
      clientId: 'cli_acme',
      number: '1001',
      status: 'open',
      currency: 'USD',
      issueDate: d('2026-07-10'),
      dueDate: d('2026-08-09'),
      paymentTerm: 'net_30',
      subject: 'Website Redesign — July',
      subtotalCents: USD(525),
      totalCents: USD(525),
      paidCents: USD(200),
      sentAt: t('2026-07-10T16:00:00.000Z'),
      publicToken: 'tok_inv_1001_demo',
      lineItems: {
        create: [
          { id: 'li_design', accountId: ACCOUNT_A, kind: 'time', itemTypeId: 'it_service', linkedProjectId: 'prj_acme_web', description: 'Design', quantity: 1.5, unitPriceCents: USD(150), amountCents: USD(225), sortOrder: 0 },
          { id: 'li_dev', accountId: ACCOUNT_A, kind: 'time', itemTypeId: 'it_service', linkedProjectId: 'prj_acme_web', description: 'Development', quantity: 2, unitPriceCents: USD(150), amountCents: USD(300), sortOrder: 1 },
        ],
      },
      payments: {
        create: [{ accountId: ACCOUNT_A, amountCents: USD(200), paidOn: d('2026-07-20'), method: 'bank_transfer', note: 'Partial' }],
      },
    },
  })
  // Lock the invoiced entries onto their line items (specs/04, INV-3/INV-4).
  await prisma.timeEntry.update({ where: { id: 'te1' }, data: { lockState: 'invoiced', invoiceLineItemId: 'li_design' } })
  await prisma.timeEntry.update({ where: { id: 'te2' }, data: { lockState: 'invoiced', invoiceLineItemId: 'li_dev' } })

  // 10. Draft invoice (Northwind, fixed fee) — no number until sent.
  await prisma.invoice.create({
    data: {
      id: 'inv_draft',
      accountId: ACCOUNT_A,
      clientId: 'cli_northwind',
      number: null,
      status: 'draft',
      currency: 'USD',
      paymentTerm: 'net_15',
      subject: 'Logo Package',
      subtotalCents: USD(5000),
      totalCents: USD(5000),
      lineItems: {
        create: [{ accountId: ACCOUNT_A, kind: 'flat', itemTypeId: 'it_service', linkedProjectId: 'prj_nw_logo', description: 'Logo Package — fixed fee', quantity: 1, unitPriceCents: USD(5000), amountCents: USD(5000), sortOrder: 0 }],
      },
    },
  })

  // 11. Expense (billable, with markup) + category.
  await prisma.expenseCategory.create({ data: { id: 'ec_software', accountId: ACCOUNT_A, name: 'Software' } })
  await prisma.expense.create({
    data: { accountId: ACCOUNT_A, userId: 'usr_frank', projectId: 'prj_acme_web', categoryId: 'ec_software', spentDate: d('2026-07-05'), totalCents: USD(49), markupPercent: 20, notes: 'Plugin license', isBillable: true },
  })

  // 12. Recurring profile + retainer.
  await prisma.recurringInvoiceProfile.create({
    data: {
      accountId: ACCOUNT_A,
      clientId: 'cli_acme',
      subject: 'Acme: Monthly Support',
      frequency: 'monthly',
      intervalCount: 1,
      nextIssueDate: d('2026-08-01'),
      status: 'active',
      amountCents: USD(4000),
      paymentTerm: 'net_30',
      templateLineItems: [{ description: 'Monthly Support Retainer', quantity: 1, unitPriceCents: USD(4000), itemTypeId: 'it_service' }],
    },
  })
  await prisma.retainer.create({
    data: { accountId: ACCOUNT_A, clientId: 'cli_acme', depositCents: USD(10000), balanceCents: USD(10000), drawnCents: 0, status: 'ongoing' },
  })

  // 13. Invoice email templates + sender address.
  await prisma.invoiceMessageTemplate.createMany({
    data: [
      { accountId: ACCOUNT_A, kind: 'invoice', subject: '%invoice_subject% from %company_name%', body: 'Hi %invoice_client%, your invoice for %invoice_subject% is ready: %invoice_url%' },
      { accountId: ACCOUNT_A, kind: 'reminder', subject: 'Reminder: %invoice_subject%', body: 'A friendly reminder that %invoice_subject% is due. View: %invoice_url%' },
      { accountId: ACCOUNT_A, kind: 'thank_you', subject: 'Thank you!', body: 'Thanks for your payment of %invoice_subject%.' },
    ],
  })
  await prisma.senderAddress.create({ data: { accountId: ACCOUNT_A, name: 'Invoices', email: 'invoices@bigsea.demo', isDefault: true } })
}

/** A second, minimal tenant — used to prove cross-account isolation (INV-5). */
async function seedAccountB() {
  await prisma.account.create({ data: { id: ACCOUNT_B, name: 'Globex (isolation test)', module: { create: {} } } })
  await prisma.user.create({
    data: { id: 'usr_zoe', accountId: ACCOUNT_B, email: 'zoe@globex.demo', passwordHash, firstName: 'Zoe', lastName: 'Owner', permissionProfile: 'administrator' },
  })
  await prisma.account.update({ where: { id: ACCOUNT_B }, data: { accountOwnerUserId: 'usr_zoe' } })
  await prisma.client.create({ data: { id: 'cli_initech', accountId: ACCOUNT_B, name: 'Initech', currency: 'USD' } })
  await prisma.project.create({
    data: { id: 'prj_initech', accountId: ACCOUNT_B, clientId: 'cli_initech', name: 'TPS Portal', projectType: 'time_and_materials', billableRateMethod: 'project', projectHourlyRateCents: USD(200) },
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

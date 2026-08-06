import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Harvest snapshot → Track2 ETL (specs/13, task #71).
 *
 * Reads a captured backup snapshot (never Harvest directly — the backup is the source of truth so
 * the import is deterministic and re-runnable) and upserts it into the Track2 domain tables. Every
 * write is keyed through MigrationIdMap(entity, harvestId → localId), which makes the whole import
 * IDEMPOTENT: re-running updates in place instead of duplicating, and a run interrupted by the
 * serverless time cap resumes exactly where it stopped.
 *
 * `dryRun` performs the full mapping and reports created/updated/skipped/error counts WITHOUT
 * writing anything — the safe preview you run before applying.
 *
 * Derivations (documented gaps — Harvest serves these from per-project endpoints not captured in
 * the flat snapshot):
 *  - Project↔task and project↔user assignments are reconstructed from the distinct combinations
 *    observed in time entries. Historical time already carries its resolved billable rate, so the
 *    data migration stays faithful; per-project rate overrides / PM flags are not reconstructed.
 *  - Invoice payments are synthesized as a single payment for the paid portion (Harvest exposes
 *    payment history only per-invoice); the amount and paid date come from the invoice itself.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type HRow = Record<string, any>

export const IMPORT_RESOURCES = [
  'clients', 'contacts', 'tasks', 'users', 'expense_categories',
  'projects', 'time_entries', 'expenses', 'invoices', 'estimates',
] as const

export type ImportCursor = { stageIndex: number; offset: number }
export type EntityTally = { created: number; updated: number; skipped: number; errors: number }
export type ImportBatchResult = {
  ok: boolean
  message?: string
  dryRun: boolean
  done: boolean
  cursor: ImportCursor | null
  /** deltas produced by THIS batch, keyed by entity */
  batch: Record<string, EntityTally>
  processedThisBatch: number
  /** total source rows across all imported resources (progress denominator) */
  totalRows: number
  stageLabel: string
  notes: string[]
}

const BATCH_BUDGET_MS = 40_000

// ---- unit helpers ----------------------------------------------------------
const cents = (v: any): number => (v == null || v === '' ? 0 : Math.round(Number(v) * 100))
const centsOrNull = (v: any): number | null => (v == null || v === '' ? null : Math.round(Number(v) * 100))
const minutesFromHours = (v: any): number => (v == null ? 0 : Math.round(Number(v) * 60))
const dateOnly = (v: any): Date | null => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : null)
const sid = (v: any): string | null => (v == null ? null : String(v))
const trailingInt = (s: any): number | null => {
  const m = String(s ?? '').match(/(\d+)\s*$/)
  return m ? Number(m[1]) : null
}

// ---- enum mappers ----------------------------------------------------------
function mapPermission(u: HRow): 'administrator' | 'project_manager' | 'member' {
  if (u.is_admin || u.access_roles?.includes?.('administrator')) return 'administrator'
  if (u.is_project_manager || u.access_roles?.includes?.('manager')) return 'project_manager'
  return 'member'
}
function mapBillMethod(billBy: any): 'none' | 'project' | 'person' | 'task' {
  switch (String(billBy ?? '').toLowerCase()) {
    case 'project': return 'project'
    case 'people': case 'person': return 'person'
    case 'tasks': case 'task': return 'task'
    default: return 'none'
  }
}
function mapProjectType(p: HRow): 'time_and_materials' | 'fixed_fee' | 'non_billable' {
  if (p.is_billable === false) return 'non_billable'
  if (p.fee != null) return 'fixed_fee'
  return 'time_and_materials'
}
function mapBudget(p: HRow): { method: any; value: number | null } {
  const by = String(p.budget_by ?? 'none').toLowerCase()
  const budget = p.budget
  if (budget == null || by === 'none') return { method: 'none', value: null }
  switch (by) {
    case 'project': return { method: 'hours_total', value: minutesFromHours(budget) }
    case 'task': return { method: 'hours_per_task', value: minutesFromHours(budget) }
    case 'person': return { method: 'hours_per_person', value: minutesFromHours(budget) }
    case 'project_cost': case 'project_fees': return { method: 'fee_total', value: cents(budget) }
    case 'cost': return { method: 'cost_total', value: cents(budget) }
    default: return { method: 'none', value: null }
  }
}
function mapInvoiceStatus(state: any): 'draft' | 'open' | 'paid' | 'written_off' | 'closed' {
  switch (String(state ?? '').toLowerCase()) {
    case 'paid': return 'paid'
    case 'closed': return 'closed'
    case 'draft': return 'draft'
    default: return 'open'
  }
}
function mapEstimateStatus(state: any): 'draft' | 'sent' | 'accepted' | 'declined' {
  switch (String(state ?? '').toLowerCase()) {
    case 'accepted': return 'accepted'
    case 'declined': return 'declined'
    case 'sent': return 'sent'
    default: return 'draft'
  }
}
function mapPaymentTerm(term: any): 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'custom' {
  const t = String(term ?? '').toLowerCase()
  if (t.includes('receipt') || t.includes('upon')) return 'due_on_receipt'
  const n = trailingInt(t)
  if (n === 15) return 'net_15'
  if (n === 30) return 'net_30'
  if (n === 45) return 'net_45'
  if (n === 60) return 'net_60'
  return t ? 'custom' : 'net_30'
}

// ---- id-map ----------------------------------------------------------------
type Maps = Record<string, Map<string, string>>
const DRY = '__dry__'

async function loadMaps(accountId: string): Promise<Maps> {
  const rows = await prisma.migrationIdMap.findMany({ where: { accountId }, select: { entity: true, harvestId: true, localId: true } })
  const maps: Maps = {}
  for (const r of rows) {
    ;(maps[r.entity] ??= new Map()).set(r.harvestId, r.localId)
  }
  return maps
}
function getLocal(maps: Maps, entity: string, harvestId: string | null): string | null {
  if (harvestId == null) return null
  const id = maps[entity]?.get(harvestId)
  return id && id !== DRY ? id : null
}
async function recordMap(maps: Maps, entity: string, harvestId: string, localId: string, dryRun: boolean, accountId: string) {
  ;(maps[entity] ??= new Map()).set(harvestId, dryRun ? DRY : localId)
  if (dryRun) return
  await prisma.migrationIdMap.upsert({
    where: { accountId_entity_harvestId: { accountId, entity, harvestId } },
    create: { accountId, entity, harvestId, localId },
    update: { localId },
  })
}

// ---- snapshot loading ------------------------------------------------------
async function loadResource(snapshotId: string, resource: string): Promise<HRow[]> {
  const parts = await prisma.migrationSnapshotPart.findMany({
    where: { snapshotId, resource },
    select: { data: true, chunk: true },
    orderBy: { chunk: 'asc' },
  })
  const out: HRow[] = []
  for (const p of parts) if (Array.isArray(p.data)) out.push(...(p.data as HRow[]))
  return out
}

// ---- stage definitions -----------------------------------------------------
type Ctx = { accountId: string; maps: Maps; dryRun: boolean }
type Stage = { entity: string; resource: string; label: string; importRow: (row: HRow, ctx: Ctx) => Promise<'created' | 'updated' | 'skipped'> }

const STAGES: Stage[] = [
  {
    entity: 'client', resource: 'clients', label: 'Clients',
    importRow: async (c, { accountId, maps, dryRun }) => {
      const hid = String(c.id)
      const data = {
        name: String(c.name ?? 'Unnamed client'),
        currency: c.currency ?? 'USD',
        address: c.address ?? null,
        isActive: c.is_active ?? true,
      }
      const local = getLocal(maps, 'client', hid)
      if (local) { if (!dryRun) await prisma.client.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.client.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'client', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'contact', resource: 'contacts', label: 'Contacts',
    importRow: async (ct, { accountId, maps, dryRun }) => {
      const hid = String(ct.id)
      const clientLocal = getLocal(maps, 'client', sid(ct.client?.id))
      if (!clientLocal) return 'skipped' // orphan contact — client not imported
      const data = {
        clientId: clientLocal,
        firstName: String(ct.first_name ?? ''),
        lastName: String(ct.last_name ?? ''),
        title: ct.title ?? null,
        email: ct.email ?? null,
        phoneOffice: ct.phone_office ?? null,
        phoneMobile: ct.phone_mobile ?? null,
      }
      const local = getLocal(maps, 'contact', hid)
      if (local) { if (!dryRun) await prisma.clientContact.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.clientContact.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'contact', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'task', resource: 'tasks', label: 'Tasks',
    importRow: async (t, { accountId, maps, dryRun }) => {
      const hid = String(t.id)
      const data = {
        name: String(t.name ?? 'Task'),
        defaultBillable: t.billable_by_default ?? true,
        defaultHourlyRateCents: centsOrNull(t.default_hourly_rate),
        autoAddToNewProjects: t.is_default ?? false,
        isActive: t.is_active ?? true,
      }
      const local = getLocal(maps, 'task', hid)
      if (local) { if (!dryRun) await prisma.task.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.task.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'task', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'user', resource: 'users', label: 'People',
    importRow: async (u, { accountId, maps, dryRun }) => {
      const hid = String(u.id)
      const email = String(u.email ?? '').toLowerCase()
      // Never overwrite an existing Track2 account (e.g. the real admins) — map to it and skip.
      const existing = email ? await prisma.user.findFirst({ where: { accountId, email }, select: { id: true } }) : null
      if (existing) {
        await recordMap(maps, 'user', hid, existing.id, dryRun, accountId)
        return 'skipped'
      }
      const local = getLocal(maps, 'user', hid)
      const data = {
        firstName: String(u.first_name ?? ''),
        lastName: String(u.last_name ?? ''),
        type: (u.is_contractor ? 'contractor' : 'employee') as any,
        permissionProfile: mapPermission(u) as any,
        capacityHoursPerWeek: u.weekly_capacity != null ? new Prisma.Decimal(Number(u.weekly_capacity) / 3600) : null,
        timezone: u.timezone ?? null,
        isActive: u.is_active ?? true,
      }
      if (local) { if (!dryRun) await prisma.user.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun
        ? DRY
        : (await prisma.user.create({
            // passwordHash is an unusable sentinel — imported people must use password-reset to sign in.
            data: { accountId, email: email || `harvest-${hid}@import.invalid`, passwordHash: '!migrated:no-login', ...data },
          })).id
      await recordMap(maps, 'user', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'expense_category', resource: 'expense_categories', label: 'Expense categories',
    importRow: async (ec, { accountId, maps, dryRun }) => {
      const hid = String(ec.id)
      const data = {
        name: String(ec.name ?? 'Category'),
        unitName: ec.unit_name ?? null,
        unitPriceCents: centsOrNull(ec.unit_price),
        isActive: ec.is_active ?? true,
      }
      const local = getLocal(maps, 'expense_category', hid)
      if (local) { if (!dryRun) await prisma.expenseCategory.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.expenseCategory.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'expense_category', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'project', resource: 'projects', label: 'Projects',
    importRow: async (p, { accountId, maps, dryRun }) => {
      const hid = String(p.id)
      const clientLocal = getLocal(maps, 'client', sid(p.client?.id))
      if (!clientLocal) return 'skipped'
      const budget = mapBudget(p)
      const data = {
        clientId: clientLocal,
        name: String(p.name ?? 'Project'),
        code: p.code ?? null,
        projectType: mapProjectType(p) as any,
        billableRateMethod: mapBillMethod(p.bill_by) as any,
        projectHourlyRateCents: centsOrNull(p.hourly_rate),
        projectFeesCents: centsOrNull(p.fee),
        budgetMethod: budget.method as any,
        budgetValue: budget.value,
        budgetResetsMonthly: p.budget_is_monthly ?? false,
        isBillable: p.is_billable ?? true,
        startsOn: dateOnly(p.starts_on),
        endsOn: dateOnly(p.ends_on),
        notes: p.notes ?? null,
        isActive: p.is_active ?? true,
      }
      const local = getLocal(maps, 'project', hid)
      if (local) { if (!dryRun) await prisma.project.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.project.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'project', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'time_entry', resource: 'time_entries', label: 'Time entries',
    importRow: async (te, ctx) => {
      const { accountId, maps, dryRun } = ctx
      const hid = String(te.id)
      const userLocal = getLocal(maps, 'user', sid(te.user?.id))
      const projectLocal = getLocal(maps, 'project', sid(te.project?.id))
      const taskLocal = getLocal(maps, 'task', sid(te.task?.id))
      if (!userLocal || !projectLocal || !taskLocal) return 'skipped'
      await ensureAssignments(ctx, projectLocal, taskLocal, userLocal)
      const lockState = (te.invoice?.id ? 'invoiced' : te.is_locked ? 'approved' : 'open') as any
      const data = {
        userId: userLocal,
        projectId: projectLocal,
        taskId: taskLocal,
        spentDate: dateOnly(te.spent_date) ?? new Date(),
        minutes: minutesFromHours(te.hours),
        notes: te.notes ?? null,
        isBillable: te.billable ?? true,
        billableRateCents: centsOrNull(te.billable_rate),
        lockState,
      }
      const local = getLocal(maps, 'time_entry', hid)
      if (local) { if (!dryRun) await prisma.timeEntry.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.timeEntry.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'time_entry', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'expense', resource: 'expenses', label: 'Expenses',
    importRow: async (ex, { accountId, maps, dryRun }) => {
      const hid = String(ex.id)
      const userLocal = getLocal(maps, 'user', sid(ex.user?.id))
      const projectLocal = getLocal(maps, 'project', sid(ex.project?.id))
      const catLocal = getLocal(maps, 'expense_category', sid(ex.expense_category?.id))
      if (!userLocal || !projectLocal || !catLocal) return 'skipped'
      const data = {
        userId: userLocal,
        projectId: projectLocal,
        categoryId: catLocal,
        spentDate: dateOnly(ex.spent_date) ?? new Date(),
        totalCents: cents(ex.total_cost),
        notes: ex.notes ?? null,
        isBillable: ex.billable ?? true,
        receiptFileUrl: ex.receipt?.url ?? null,
        lockState: (ex.invoice?.id ? 'invoiced' : 'open') as any,
      }
      const local = getLocal(maps, 'expense', hid)
      if (local) { if (!dryRun) await prisma.expense.update({ where: { id: local }, data }); return 'updated' }
      const id = dryRun ? DRY : (await prisma.expense.create({ data: { accountId, ...data } })).id
      await recordMap(maps, 'expense', hid, id, dryRun, accountId)
      return 'created'
    },
  },
  {
    entity: 'invoice', resource: 'invoices', label: 'Invoices',
    importRow: async (inv, { accountId, maps, dryRun }) => {
      const hid = String(inv.id)
      const clientLocal = getLocal(maps, 'client', sid(inv.client?.id))
      if (!clientLocal) return 'skipped'
      const total = cents(inv.amount)
      const due = inv.due_amount != null ? cents(inv.due_amount) : total
      const paid = Math.max(0, total - due)
      const data = {
        clientId: clientLocal,
        number: inv.number != null ? String(inv.number) : null,
        status: mapInvoiceStatus(inv.state) as any,
        currency: inv.currency ?? 'USD',
        issueDate: dateOnly(inv.issue_date),
        dueDate: dateOnly(inv.due_date),
        paymentTerm: mapPaymentTerm(inv.payment_term) as any,
        subject: inv.subject ?? null,
        poNumber: inv.purchase_order ?? null,
        notes: inv.notes ?? null,
        subtotalCents: cents(inv.amount) - cents(inv.tax_amount) - cents(inv.tax2_amount) + cents(inv.discount_amount),
        tax1Name: inv.tax != null ? 'Tax' : null,
        tax1Percent: inv.tax != null ? new Prisma.Decimal(Number(inv.tax)) : null,
        tax2Name: inv.tax2 != null ? 'Tax 2' : null,
        tax2Percent: inv.tax2 != null ? new Prisma.Decimal(Number(inv.tax2)) : null,
        taxCents: cents(inv.tax_amount) + cents(inv.tax2_amount),
        discountPercent: inv.discount != null ? new Prisma.Decimal(Number(inv.discount)) : null,
        discountCents: cents(inv.discount_amount),
        totalCents: total,
        paidCents: paid,
        sentAt: inv.sent_at ? new Date(inv.sent_at) : null,
      }
      const lineItems: HRow[] = Array.isArray(inv.line_items) ? inv.line_items : []
      const local = getLocal(maps, 'invoice', hid)
      let invoiceId = local
      if (local) {
        if (!dryRun) {
          await prisma.invoice.update({ where: { id: local }, data })
          await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: local } }) // rebuild children
        }
      } else {
        invoiceId = dryRun ? DRY : (await prisma.invoice.create({ data: { accountId, ...data } })).id
        await recordMap(maps, 'invoice', hid, invoiceId!, dryRun, accountId)
      }
      if (!dryRun && invoiceId && invoiceId !== DRY) {
        let sort = 0
        for (const li of lineItems) {
          await prisma.invoiceLineItem.create({
            data: {
              accountId, invoiceId,
              kind: 'free_form',
              linkedProjectId: getLocal(maps, 'project', sid(li.project?.id)),
              description: String(li.description ?? li.kind ?? ''),
              quantity: new Prisma.Decimal(Number(li.quantity ?? 1)),
              unitPriceCents: cents(li.unit_price),
              amountCents: cents(li.amount),
              taxable: li.taxed ?? true,
              sortOrder: sort++,
            },
          })
        }
        // Synthesize a single payment for the paid portion (Harvest payment history is not captured).
        const payEntity = 'invoice_payment'
        const payHid = `${hid}:synth`
        const payLocal = getLocal(maps, payEntity, payHid)
        if (paid > 0) {
          const payData = {
            invoiceId,
            amountCents: paid,
            paidOn: dateOnly(inv.paid_date) ?? dateOnly(inv.paid_at) ?? dateOnly(inv.issue_date) ?? new Date(),
            method: 'other' as any,
            note: 'Imported from Harvest',
          }
          if (payLocal) await prisma.payment.update({ where: { id: payLocal }, data: payData })
          else {
            const pid = (await prisma.payment.create({ data: { accountId, ...payData } })).id
            await recordMap(maps, payEntity, payHid, pid, dryRun, accountId)
          }
        }
      }
      return local ? 'updated' : 'created'
    },
  },
  {
    entity: 'estimate', resource: 'estimates', label: 'Estimates',
    importRow: async (es, { accountId, maps, dryRun }) => {
      const hid = String(es.id)
      const clientLocal = getLocal(maps, 'client', sid(es.client?.id))
      if (!clientLocal) return 'skipped'
      const data = {
        clientId: clientLocal,
        number: es.number != null ? String(es.number) : null,
        status: mapEstimateStatus(es.state) as any,
        currency: es.currency ?? 'USD',
        subject: es.subject ?? null,
        notes: es.notes ?? null,
        subtotalCents: cents(es.amount) - cents(es.tax_amount) - cents(es.tax2_amount) + cents(es.discount_amount),
        tax1Name: es.tax != null ? 'Tax' : null,
        tax1Percent: es.tax != null ? new Prisma.Decimal(Number(es.tax)) : null,
        taxCents: cents(es.tax_amount) + cents(es.tax2_amount),
        discountPercent: es.discount != null ? new Prisma.Decimal(Number(es.discount)) : null,
        discountCents: cents(es.discount_amount),
        totalCents: cents(es.amount),
        sentAt: es.sent_at ? new Date(es.sent_at) : null,
      }
      const lineItems: HRow[] = Array.isArray(es.line_items) ? es.line_items : []
      const local = getLocal(maps, 'estimate', hid)
      let estimateId = local
      if (local) {
        if (!dryRun) {
          await prisma.estimate.update({ where: { id: local }, data })
          await prisma.estimateLineItem.deleteMany({ where: { estimateId: local } })
        }
      } else {
        estimateId = dryRun ? DRY : (await prisma.estimate.create({ data: { accountId, ...data } })).id
        await recordMap(maps, 'estimate', hid, estimateId!, dryRun, accountId)
      }
      if (!dryRun && estimateId && estimateId !== DRY) {
        let sort = 0
        for (const li of lineItems) {
          await prisma.estimateLineItem.create({
            data: {
              accountId, estimateId,
              description: String(li.description ?? li.kind ?? ''),
              quantity: new Prisma.Decimal(Number(li.quantity ?? 1)),
              unitPriceCents: cents(li.unit_price),
              amountCents: cents(li.amount),
              taxable: li.taxed ?? true,
              sortOrder: sort++,
            },
          })
        }
      }
      return local ? 'updated' : 'created'
    },
  },
]

// ---- assignment derivation (from time entries) -----------------------------
const seenTaskAsg = new Set<string>()
const seenUserAsg = new Set<string>()
async function ensureAssignments(ctx: Ctx, projectId: string, taskId: string, userId: string) {
  if (ctx.dryRun) return
  const tk = `${projectId}|${taskId}`
  if (!seenTaskAsg.has(tk)) {
    seenTaskAsg.add(tk)
    await prisma.projectTaskAssignment.upsert({
      where: { projectId_taskId: { projectId, taskId } },
      create: { accountId: ctx.accountId, projectId, taskId },
      update: {},
    })
  }
  const uk = `${projectId}|${userId}`
  if (!seenUserAsg.has(uk)) {
    seenUserAsg.add(uk)
    await prisma.projectUserAssignment.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { accountId: ctx.accountId, projectId, userId },
      update: {},
    })
  }
}

// ---- batch driver ----------------------------------------------------------
export async function runImportBatch(
  accountId: string,
  snapshotId: string,
  opts: { dryRun: boolean; cursor?: ImportCursor | null },
): Promise<ImportBatchResult> {
  const snap = await prisma.migrationSnapshot.findFirst({ where: { id: snapshotId, accountId }, select: { entityCounts: true } })
  if (!snap) return { ok: false, message: 'Snapshot not found.', dryRun: opts.dryRun, done: true, cursor: null, batch: {}, processedThisBatch: 0, totalRows: 0, stageLabel: '', notes: [] }
  const counts = (snap.entityCounts as Record<string, number> | null) ?? {}
  const totalRows = IMPORT_RESOURCES.reduce((a, r) => a + (counts[r] ?? 0), 0)

  const maps = await loadMaps(accountId)
  const dryRun = opts.dryRun
  let stageIndex = opts.cursor?.stageIndex ?? 0
  let offset = opts.cursor?.offset ?? 0

  const batch: Record<string, EntityTally> = {}
  const notes: string[] = []
  const tally = (e: string, k: 'created' | 'updated' | 'skipped' | 'errors') => {
    ;(batch[e] ??= { created: 0, updated: 0, skipped: 0, errors: 0 })[k]++
  }

  const start = Date.now()
  let processedThisBatch = 0
  let stageLabel = STAGES[Math.min(stageIndex, STAGES.length - 1)]?.label ?? ''

  while (stageIndex < STAGES.length) {
    const stage = STAGES[stageIndex]
    stageLabel = stage.label
    const rows = await loadResource(snapshotId, stage.resource)
    for (; offset < rows.length; offset++) {
      if (Date.now() - start > BATCH_BUDGET_MS && processedThisBatch > 0) {
        return { ok: true, dryRun, done: false, cursor: { stageIndex, offset }, batch, processedThisBatch, totalRows, stageLabel, notes }
      }
      try {
        const outcome = await stage.importRow(rows[offset], { accountId, maps, dryRun })
        tally(stage.entity, outcome)
      } catch (e) {
        tally(stage.entity, 'errors')
        if (notes.length < 12) notes.push(`${stage.entity} #${rows[offset]?.id}: ${(e as Error).message?.slice(0, 140)}`)
      }
      processedThisBatch++
    }
    stageIndex++
    offset = 0
  }

  // Done — bump document-number sequences past the highest imported number so new docs don't collide.
  if (!dryRun) {
    const [invMax, estMax] = await Promise.all([
      prisma.invoice.aggregate({ where: { accountId }, _max: { number: true } }),
      prisma.estimate.aggregate({ where: { accountId }, _max: { number: true } }),
    ])
    const invN = trailingInt(invMax._max.number)
    const estN = trailingInt(estMax._max.number)
    const acct = await prisma.account.findUnique({ where: { id: accountId }, select: { invoiceNumberSeq: true, estimateNumberSeq: true } })
    await prisma.account.update({
      where: { id: accountId },
      data: {
        invoiceNumberSeq: Math.max(acct?.invoiceNumberSeq ?? 1000, invN ?? 0),
        estimateNumberSeq: Math.max(acct?.estimateNumberSeq ?? 1000, estN ?? 0),
      },
    })
    seenTaskAsg.clear()
    seenUserAsg.clear()
  }

  return { ok: true, dryRun, done: true, cursor: null, batch, processedThisBatch, totalRows, stageLabel: 'Done', notes }
}

/** Pure transform functions, exported for unit testing (no I/O). */
export const _mappers = {
  cents, centsOrNull, minutesFromHours, dateOnly, trailingInt,
  mapPermission, mapBillMethod, mapProjectType, mapBudget,
  mapInvoiceStatus, mapEstimateStatus, mapPaymentTerm,
}

/** The snapshot that can be imported: newest complete, else newest partial. */
export async function getImportableSnapshot(accountId: string) {
  return (
    (await prisma.migrationSnapshot.findFirst({ where: { accountId, status: 'complete' }, orderBy: { createdAt: 'desc' } })) ??
    (await prisma.migrationSnapshot.findFirst({ where: { accountId, status: 'partial' }, orderBy: { createdAt: 'desc' } }))
  )
}

import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getModules } from '@/lib/modules'
import { managedProjectIdsFor, mayActForOnProject, resolveSubjectUserId } from '@/lib/timesheetSubject'
import { expenseBilledCents } from '@/modules/invoicing/generateInvoice'
import { obj, str, id, date, num, int, bool } from '@/modules/mcp/schema'
import { notFound, forbidden, invalid } from '@/modules/mcp/errors'
import { filterFingerprint, offsetFromCursor, encodeCursor } from '@/modules/mcp/cursor'
import { amountOf, centsFromAmount, ymdOf } from '@/modules/mcp/format'
import { timeReadScope, resolveUserFilter } from '@/modules/mcp/scope'
import { accountToday, dateArg, rangeArgs, limitOf, MAX_LIMIT, type Tool, type McpContext } from '../context'

const EXPENSE_SELECT = {
  id: true, projectId: true, categoryId: true, userId: true, spentDate: true, totalCents: true, markupPercent: true, notes: true,
  isBillable: true, receiptFileUrl: true, lockState: true, invoiceLineItemId: true, updatedAt: true,
  project: { select: { name: true, code: true, clientId: true, billingCurrency: true, client: { select: { name: true, currency: true } } } },
  category: { select: { name: true, unitName: true, unitPriceCents: true } },
  user: { select: { firstName: true, lastName: true } },
  invoiceLineItem: { select: { invoiceId: true } },
} as const
type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof EXPENSE_SELECT }>

function expenseRow(e: ExpenseRow) {
  const unitBased = e.category.unitPriceCents != null
  const invoiced = e.invoiceLineItemId != null || e.lockState === 'invoiced'
  return {
    id: e.id,
    project_id: e.projectId,
    project_name: e.project.name,
    client_id: e.project.clientId,
    client_name: e.project.client.name,
    expense_category_id: e.categoryId,
    category_name: e.category.name,
    user_id: e.userId,
    user_name: `${e.user.firstName} ${e.user.lastName}`.trim(),
    total_cost: amountOf(e.totalCents),
    markup_percent: e.markupPercent != null ? Number(e.markupPercent) : null,
    billable_amount: e.isBillable ? amountOf(expenseBilledCents(e.totalCents, e.markupPercent != null ? Number(e.markupPercent) : null)) : null,
    currency_code: e.project.billingCurrency ?? e.project.client.currency,
    units: unitBased && e.category.unitPriceCents ? Math.round((e.totalCents / e.category.unitPriceCents) * 100) / 100 : null,
    spent_at: ymdOf(e.spentDate),
    notes: e.notes,
    billable: e.isBillable,
    has_receipt: !!e.receiptFileUrl,
    is_invoiced: invoiced,
    is_billed: invoiced,
    updated_at: e.updatedAt.toISOString(),
  }
}

function expenseDetail(e: ExpenseRow) {
  return {
    ...expenseRow(e),
    is_unit_based: e.category.unitPriceCents != null,
    unit_name: e.category.unitName,
    unit_price: amountOf(e.category.unitPriceCents),
    receipt_url: e.receiptFileUrl,
    invoice_id: e.invoiceLineItem?.invoiceId ?? null,
    is_locked: e.lockState === 'invoiced' || e.invoiceLineItemId != null,
  }
}

/** Read gate for one expense: own, or within the caller's time/expense scope. not_found otherwise (Harvest). */
async function readableExpense(ctx: McpContext, expenseId: string): Promise<ExpenseRow> {
  const e = await prisma.expense.findFirst({ where: { id: expenseId, accountId: ctx.user.accountId }, select: EXPENSE_SELECT })
  if (!e) throw notFound('Expense')
  if (e.userId === ctx.user.userId) return e
  const scope = timeReadScope(ctx.actor)
  if (scope === 'all') return e
  if (scope === 'managed') {
    const managed = await managedProjectIdsFor(ctx.user)
    if (managed?.has(e.projectId)) return e
  }
  throw notFound('Expense')
}

async function requireExpenseModule(accountId: string) {
  if (!(await getModules(accountId)).expenseTracking) throw invalid('Expense tracking is switched off for this account.')
}

/** total_cost (amount categories) or units (unit-priced categories) → cents. */
function costCents(category: { name: string; unitPriceCents: number | null }, totalCost: unknown, units: unknown): number {
  const unitBased = category.unitPriceCents != null
  if (units !== undefined && totalCost !== undefined) throw invalid('Provide total_cost OR units, not both.', { field: 'units' })
  if (unitBased) {
    if (units === undefined) throw invalid(`units: "${category.name}" is unit-based — pass units (cost = units × unit price).`, { field: 'units' })
    const u = units as number
    if (!(u > 0)) throw invalid('units: must be greater than 0.', { field: 'units' })
    return Math.round(u * category.unitPriceCents!)
  }
  if (units !== undefined) throw invalid(`units: "${category.name}" is amount-based — pass total_cost.`, { field: 'units' })
  if (totalCost === undefined) throw invalid('total_cost: is required for this category.', { field: 'total_cost' })
  return centsFromAmount(totalCost as number, 'total_cost')
}

// ---------------------------------------------------------------------------

const listExpenses: Tool = {
  name: 'list_expenses',
  description:
    'List expenses, most recent first. Filter by `project_id`, `user_id`, a date range (`from`/`to`, default the last 30 days), or `billable`. When `user_id` is omitted you get everyone you’re allowed to see — your own as a Member, plus your managed projects as a Project Manager, or the whole account as an admin. Each row carries `is_invoiced` (true once on an invoice; `is_billed` is a deprecated alias). Returns `limit` expenses per page (default 100, max 500) with `next_cursor`. Use `get_expense` for full detail.',
  inputSchema: obj({
    project_id: id('Filter to expenses on this project id.'),
    user_id: id('Filter to expenses for this user id. Reading other users requires manager/admin permissions.'),
    from: date('Earliest spent-on date, inclusive (YYYY-MM-DD).'),
    to: date('Latest spent-on date, inclusive (YYYY-MM-DD).'),
    billable: bool('Filter to billable (true) or non-billable (false) expenses.'),
    limit: int('Page size, whole number 1–500. Omit to use the default of 100.', { minimum: 1, maximum: MAX_LIMIT }),
    cursor: str('Opaque pagination token: pass back the exact `next_cursor` with all other parameters identical.'),
  }),
  write: false,
  async handler(args, ctx) {
    const { from, to } = await rangeArgs(ctx, args)
    const limit = limitOf(args.limit)
    const f = resolveUserFilter(timeReadScope(ctx.actor), ctx.user.userId, args.user_id !== undefined ? [String(args.user_id)] : undefined)
    const and: Prisma.ExpenseWhereInput[] = []
    if (f.userIds) and.push({ userId: { in: f.userIds } })
    if (f.managedOnly) {
      const managed = [...((await managedProjectIdsFor(ctx.user)) ?? new Set<string>())]
      and.push({ OR: [{ userId: ctx.user.userId }, { projectId: { in: managed } }] })
    }
    if (args.project_id) and.push({ projectId: String(args.project_id) })
    if (args.billable !== undefined) and.push({ isBillable: args.billable as boolean })
    const fp = filterFingerprint({ t: 'expenses', from: ymdOf(from), to: ymdOf(to), project_id: args.project_id, user_id: args.user_id, billable: args.billable, limit })
    const offset = offsetFromCursor(args.cursor as string | undefined, fp)
    const rows = await prisma.expense.findMany({
      where: { accountId: ctx.user.accountId, spentDate: { gte: from, lte: to }, AND: and },
      select: EXPENSE_SELECT,
      orderBy: [{ spentDate: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    })
    const truncated = rows.length > limit
    return {
      expenses: rows.slice(0, limit).map(expenseRow),
      from: ymdOf(from),
      to: ymdOf(to),
      limit,
      truncated,
      next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null,
      scope_limited: f.scopeLimited,
    }
  },
}

const getExpense: Tool = {
  name: 'get_expense',
  description:
    'Return one expense with full detail: amounts (total, markup, billable amount), units, category (with unit metadata), project and client, currency, billable / invoiced / locked status, and whether a receipt link is attached. Use `list_expenses` first to find the id. An expense you’re not permitted to read returns `not_found`.',
  inputSchema: obj({ id: id('Expense id.') }, ['id']),
  write: false,
  async handler(args, ctx) {
    return expenseDetail(await readableExpense(ctx, String(args.id)))
  },
}

const createExpense: Tool = {
  name: 'create_expense',
  description:
    'Create an expense for yourself (or, for managers/admins, another user via `user_id` on a project in their scope). Provide `total_cost` for amount-based categories or `units` for unit-based ones (see list_expense_categories; cost = units × unit price). Defaults to billable and to today in the account timezone. Receipt upload is not supported.',
  inputSchema: obj(
    {
      project_id: id('Project id the expense belongs to.'),
      expense_category_id: id('Expense category id (from list_expense_categories).'),
      spent_at: date('Date the expense was incurred (YYYY-MM-DD). Defaults to today.'),
      total_cost: num('Total cost as a decimal (amount-based categories).'),
      units: num('Number of units (unit-based categories).'),
      notes: str('Optional notes.'),
      billable: bool('Whether the expense is billable to the client. Defaults to true.'),
      user_id: id('Create on behalf of another user (manager/admin); defaults to you.'),
    },
    ['project_id', 'expense_category_id'],
  ),
  write: true,
  async handler(args, ctx) {
    const { accountId } = ctx.user
    await requireExpenseModule(accountId)
    const projectId = String(args.project_id)
    const [project, category] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, accountId }, select: { id: true, isActive: true } }),
      prisma.expenseCategory.findFirst({ where: { id: String(args.expense_category_id), accountId }, select: { id: true, name: true, unitPriceCents: true, isActive: true } }),
    ])
    if (!project) throw notFound('Project')
    if (!category) throw notFound('Expense category')
    if (!category.isActive) throw invalid('expense_category_id: that category is archived.', { field: 'expense_category_id' })
    const userId = await resolveSubjectUserId(ctx.user, args.user_id !== undefined ? String(args.user_id) : undefined)
    if (!userId) throw forbidden('You can’t record expenses for that person.')
    if (!(await mayActForOnProject(ctx.user, userId, projectId))) throw forbidden('You can’t record expenses for that person on this project.')
    const totalCents = costCents(category, args.total_cost, args.units)
    const spentDate = dateArg(args.spent_at, 'spent_at') ?? (await accountToday(ctx))
    const e = await prisma.expense.create({
      data: {
        accountId,
        userId,
        projectId,
        categoryId: category.id,
        spentDate,
        totalCents,
        isBillable: args.billable === undefined ? true : (args.billable as boolean),
        notes: (args.notes as string | undefined)?.trim() || null,
      },
      select: EXPENSE_SELECT,
    })
    return expenseDetail(e)
  },
}

const updateExpense: Tool = {
  name: 'update_expense',
  description:
    'Update an expense’s amount (`total_cost` or `units`), notes, billable flag, project, category, or date. Pass `delete_receipt: true` to remove an attached receipt link. You get `not_found` if the expense isn’t visible to you; invoiced expenses (including ones on a draft invoice) can’t be changed (`validation_failed`).',
  inputSchema: obj(
    {
      id: id('Id of the expense to update.'),
      total_cost: num('New total cost.'),
      units: num('New number of units (unit-based categories).'),
      notes: str('Replacement notes.'),
      billable: bool('Whether the expense is billable to the client.'),
      project_id: id('Move to a different project.'),
      expense_category_id: id('Move to a different expense category.'),
      spent_at: date('Move to a different date (YYYY-MM-DD).'),
      delete_receipt: bool('Remove the attached receipt link.'),
    },
    ['id'],
  ),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const { accountId } = ctx.user
    const e = await prisma.expense.findFirst({
      where: { id: String(args.id), accountId },
      select: { id: true, userId: true, projectId: true, totalCents: true, lockState: true, invoiceLineItemId: true, category: { select: { id: true, name: true, unitPriceCents: true } } },
    })
    // Same guard as the Expenses page: owner, or someone who may edit their time on this project.
    if (!e || (e.userId !== ctx.user.userId && !(await mayActForOnProject(ctx.user, e.userId, e.projectId)))) throw notFound('Expense')
    if (e.lockState === 'invoiced' || e.invoiceLineItemId) throw invalid('This expense is on an invoice and can’t be changed.')
    const data: Prisma.ExpenseUncheckedUpdateManyInput = {}
    if (args.project_id !== undefined && String(args.project_id) !== e.projectId) {
      const project = await prisma.project.findFirst({ where: { id: String(args.project_id), accountId }, select: { id: true } })
      if (!project) throw notFound('Project')
      if (e.userId !== ctx.user.userId && !(await mayActForOnProject(ctx.user, e.userId, project.id))) throw forbidden('You can only move expenses to projects you manage.')
      data.projectId = project.id
    }
    let category = e.category
    if (args.expense_category_id !== undefined && String(args.expense_category_id) !== e.category.id) {
      const c = await prisma.expenseCategory.findFirst({ where: { id: String(args.expense_category_id), accountId }, select: { id: true, name: true, unitPriceCents: true } })
      if (!c) throw notFound('Expense category')
      category = c
      data.categoryId = c.id
    }
    if (args.total_cost !== undefined || args.units !== undefined) data.totalCents = costCents(category, args.total_cost, args.units)
    if (args.notes !== undefined) data.notes = String(args.notes).trim() || null
    if (args.billable !== undefined) data.isBillable = args.billable as boolean
    const spentDate = dateArg(args.spent_at, 'spent_at')
    if (spentDate) data.spentDate = spentDate
    if (args.delete_receipt) data.receiptFileUrl = null
    // Conditional on still being un-invoiced (a draft could have claimed it since the read).
    const { count } = await prisma.expense.updateMany({
      where: { id: e.id, accountId, lockState: 'open', invoiceLineItemId: null },
      data,
    })
    if (count === 0) throw invalid('This expense is on an invoice and can’t be changed.')
    return expenseDetail(await prisma.expense.findUniqueOrThrow({ where: { id: e.id }, select: EXPENSE_SELECT }))
  },
}

export const expenseTools: Tool[] = [listExpenses, getExpense, createExpense, updateExpense]

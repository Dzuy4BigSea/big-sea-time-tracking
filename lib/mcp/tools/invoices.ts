import 'server-only'
import { Prisma, type PaymentTerm } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { addDays } from '@/lib/week'
import { generateInvoice, GenerateInvoiceError } from '@/modules/invoicing/generateInvoice'
import { computeTotals } from '@/modules/invoicing/totals'
import { recomputeInvoiceTotals } from '@/modules/invoicing/recomputeTotals'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import type { TimeGrouping } from '@/modules/invoicing/lineItems'
import { lineAmountCents } from '@/modules/shared/money'
import { obj, str, id, ids, date, num, int, bool, type Prop } from '@/modules/mcp/schema'
import { notFound, invalid } from '@/modules/mcp/errors'
import { filterFingerprint, offsetFromCursor, encodeCursor } from '@/modules/mcp/cursor'
import { amountOf, centsFromAmount, harvestInvoiceState, paymentTermFrom, TERM_DAYS, ymdOf } from '@/modules/mcp/format'
import { accountToday, dateArg, requireCap, limitOf, MAX_LIMIT, type Tool, type McpContext } from '../context'

const NO_INVOICE_PERMISSION = 'You do not have permission to manage invoices (Track2 shows invoices only to people who can manage them).'

const HEADER_SELECT = {
  id: true, number: true, status: true, currency: true, issueDate: true, dueDate: true, sentAt: true, subject: true, poNumber: true,
  notes: true, paymentTerm: true, subtotalCents: true, discountPercent: true, discountCents: true, tax1Percent: true, tax2Percent: true,
  taxCents: true, totalCents: true, paidCents: true, createdFromEstimateId: true, updatedAt: true, clientId: true,
  client: { select: { name: true } },
} as const
type HeaderRow = Prisma.InvoiceGetPayload<{ select: typeof HEADER_SELECT }>

function headerRow(inv: HeaderRow, today: Date) {
  return {
    id: inv.id,
    number: inv.number, // Track2 assigns the number when the invoice is sent; drafts have null
    client_id: inv.clientId,
    client_name: inv.client.name,
    state: harvestInvoiceState(inv.status),
    display_status: displayBadge({ status: inv.status as StoredStatus, sentAt: inv.sentAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents }, today),
    subject: inv.subject,
    amount: amountOf(inv.totalCents),
    due_amount: amountOf(inv.totalCents - inv.paidCents),
    currency_code: inv.currency,
    estimate_id: inv.createdFromEstimateId,
    retainer_id: null,
    recurring_invoice_id: null,
    issued_at: ymdOf(inv.issueDate),
    due_at: ymdOf(inv.dueDate),
    sent_at: inv.sentAt ? inv.sentAt.toISOString() : null,
    updated_at: inv.updatedAt.toISOString(),
  }
}

async function invoiceDetail(ctx: McpContext, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId: ctx.user.accountId },
    select: {
      ...HEADER_SELECT,
      lineItems: {
        select: {
          id: true, kind: true, description: true, quantity: true, unitPriceCents: true, amountCents: true, taxable: true, linkedProjectId: true,
          itemType: { select: { name: true } },
          linkedProject: { select: { name: true } },
          _count: { select: { timeEntries: true, expenses: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!inv) throw notFound('Invoice')
  const t = computeTotals({
    lineItems: inv.lineItems.map((l) => ({ amountCents: l.amountCents, taxable: l.taxable })),
    discountPercent: inv.discountPercent ? Number(inv.discountPercent) : null,
    tax1Percent: inv.tax1Percent ? Number(inv.tax1Percent) : null,
    tax2Percent: inv.tax2Percent ? Number(inv.tax2Percent) : null,
  })
  return {
    ...headerRow(inv, await accountToday(ctx)),
    purchase_order: inv.poNumber,
    notes: inv.notes,
    payment_term: inv.paymentTerm,
    subtotal: amountOf(inv.subtotalCents),
    discount: inv.discountPercent ? Number(inv.discountPercent) : null,
    discount_amount: amountOf(inv.discountCents),
    tax: inv.tax1Percent ? Number(inv.tax1Percent) : null,
    tax_amount: amountOf(t.tax1Cents),
    tax2: inv.tax2Percent ? Number(inv.tax2Percent) : null,
    tax2_amount: amountOf(t.tax2Cents),
    paid_amount: amountOf(inv.paidCents),
    line_items: inv.lineItems.map((l) => ({
      id: l.id,
      kind: l.itemType?.name ?? (l.kind === 'expense' ? 'Expense' : 'Service'),
      line_type: l.kind, // Track2: time | expense | free_form | flat (fixed fee)
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: amountOf(l.unitPriceCents),
      amount: amountOf(l.amountCents),
      taxed: l.taxable,
      taxed2: l.taxable && !!inv.tax2Percent,
      project_id: l.linkedProjectId,
      project_name: l.linkedProject?.name ?? null,
      time_entry_count: l._count.timeEntries,
      expense_count: l._count.expenses,
    })),
  }
}

const cursorProp = str('Opaque pagination token. Omit on the first request; on later pages pass back the exact `next_cursor` from the prior response, with all other parameters identical.')

// ---------------------------------------------------------------------------
// list_invoices / get_invoice
// ---------------------------------------------------------------------------

const listInvoices: Tool = {
  name: 'list_invoices',
  description:
    'List invoices, most recent first (by issue date; unsent drafts first). Filter by `status` (draft / open / sent / paid / late, plus Track2’s written_off / closed), `client_id`, issue-date range (`issued_from` / `issued_to`), an exact `due_date`, or `search` (invoice number, subject, PO). `sent` = open and not past due; `late` = open and past due. Track2 has no invoice-approval step and assigns the invoice `number` when it is sent (drafts have `number: null`). Requires invoice permission. Returns `limit` invoices per page (default 100, max 500) with `next_cursor`. Use `get_invoice` for line items.',
  inputSchema: obj({
    status: str('Filter to one status.', { enum: ['draft', 'open', 'sent', 'paid', 'late', 'written_off', 'closed'] }),
    client_id: id('Filter to invoices for this client id.'),
    issued_from: date('Earliest issue date, inclusive (YYYY-MM-DD).'),
    issued_to: date('Latest issue date, inclusive (YYYY-MM-DD).'),
    due_date: date('Filter to invoices due on this exact date (YYYY-MM-DD).'),
    search: str('Case-insensitive match on invoice number, subject, or PO number.'),
    limit: int('Page size, whole number 1–500. Omit to use the default of 100.', { minimum: 1, maximum: MAX_LIMIT }),
    cursor: cursorProp,
  }),
  write: false,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_invoices', NO_INVOICE_PERMISSION)
    const today = await accountToday(ctx)
    const limit = limitOf(args.limit)
    const status = args.status as string | undefined
    const and: Prisma.InvoiceWhereInput[] = []
    if (status === 'sent') and.push({ status: 'open', OR: [{ dueDate: null }, { dueDate: { gte: today } }] })
    else if (status === 'late') and.push({ status: 'open', dueDate: { lt: today } })
    else if (status) and.push({ status: status as StoredStatus })
    if (args.client_id) and.push({ clientId: String(args.client_id) })
    const issuedFrom = dateArg(args.issued_from, 'issued_from')
    const issuedTo = dateArg(args.issued_to, 'issued_to')
    if (issuedFrom || issuedTo) and.push({ issueDate: { ...(issuedFrom ? { gte: issuedFrom } : {}), ...(issuedTo ? { lte: issuedTo } : {}) } })
    const due = dateArg(args.due_date, 'due_date')
    if (due) and.push({ dueDate: due })
    const search = (args.search as string | undefined)?.trim()
    if (search) {
      and.push({ OR: [{ number: { contains: search, mode: 'insensitive' } }, { subject: { contains: search, mode: 'insensitive' } }, { poNumber: { contains: search, mode: 'insensitive' } }] })
    }
    const where: Prisma.InvoiceWhereInput = { accountId: ctx.user.accountId, AND: and }
    const fp = filterFingerprint({ t: 'invoices', status, client_id: args.client_id, issuedFrom: args.issued_from, issuedTo: args.issued_to, due: args.due_date, search, limit })
    const offset = offsetFromCursor(args.cursor as string | undefined, fp)
    const rows = await prisma.invoice.findMany({
      where,
      select: HEADER_SELECT,
      orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    })
    const truncated = rows.length > limit
    return {
      invoices: rows.slice(0, limit).map((r) => headerRow(r, today)),
      limit,
      truncated,
      next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null,
    }
  },
}

const getInvoice: Tool = {
  name: 'get_invoice',
  description:
    'Return one invoice with its header (client, state, amounts, taxes, discount, dates, PO, notes) and full `line_items` (each with `line_type`: time / expense / free_form / flat for a fixed fee, the linked project, and how many time entries / expenses it bills). Use `list_invoices` first to find the id. Requires invoice permission; an id outside your account returns `not_found`.',
  inputSchema: obj({ id: id('Invoice id.') }, ['id']),
  write: false,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_invoices', NO_INVOICE_PERMISSION)
    return invoiceDetail(ctx, String(args.id))
  },
}

// ---------------------------------------------------------------------------
// create_invoice / create_invoice_from_tracked_time (drafts only)
// ---------------------------------------------------------------------------

const headerProps: Record<string, Prop> = {
  issue_date: date('Issue date (YYYY-MM-DD). Defaults to today in the account timezone.'),
  due_date: date('Due date (YYYY-MM-DD). Takes precedence over payment_term.'),
  payment_term: str('Payment term: "upon receipt", "net 15", "net 30" (default), "net 45", "net 60". Ignored when due_date is given.'),
  subject: str('Optional invoice subject line.'),
  notes: str('Optional notes shown on the invoice.'),
  purchase_order: str('Optional purchase order reference.'),
  discount: num('Optional discount as a percentage.', { minimum: 0, maximum: 100 }),
  tax: num('Optional first tax rate as a percentage.', { minimum: 0, maximum: 100 }),
  tax2: num('Optional second tax rate as a percentage.', { minimum: 0, maximum: 100 }),
  currency: str('ISO 4217 code. Track2 invoices use the client’s currency; any other value is rejected.'),
}

/** Header fields (dates, terms, subject, taxes) from the shared Harvest parameters. */
async function headerData(ctx: McpContext, args: Record<string, unknown>, clientCurrency: string) {
  if (args.currency !== undefined && String(args.currency).toUpperCase() !== clientCurrency) {
    throw invalid(`currency: invoices for this client are in ${clientCurrency}.`, { field: 'currency' })
  }
  const issueDate = dateArg(args.issue_date, 'issue_date') ?? (await accountToday(ctx))
  const explicitDue = dateArg(args.due_date, 'due_date')
  const paymentTerm: PaymentTerm = explicitDue ? 'custom' : args.payment_term !== undefined ? paymentTermFrom(String(args.payment_term)) : 'net_30'
  const dueDate = explicitDue ?? addDays(issueDate, TERM_DAYS[paymentTerm] ?? 30)
  if (dueDate < issueDate) throw invalid('due_date must be on or after issue_date.', { field: 'due_date' })
  const dec = (v: unknown) => (v === undefined || v === 0 ? null : new Prisma.Decimal(v as number))
  return {
    issueDate,
    dueDate,
    paymentTerm,
    ...(args.subject !== undefined ? { subject: String(args.subject).trim() || null } : {}),
    ...(args.notes !== undefined ? { notes: String(args.notes) || null } : {}),
    ...(args.purchase_order !== undefined ? { poNumber: String(args.purchase_order).trim() || null } : {}),
    discountPercent: dec(args.discount),
    tax1Percent: dec(args.tax),
    tax2Percent: dec(args.tax2),
  }
}

const lineItemSchema = obj({
  kind: str('Item type name (e.g. "Service", "Product"); must exist in Track2’s item types. Defaults to Service.'),
  description: str('Line item description.'),
  quantity: num('Quantity. Defaults to 1.', { minimum: 0 }),
  unit_price: num('Unit price.'),
  project_id: id('Optional project (of this client) to associate the line with.'),
  taxed: bool('Whether tax applies to this line. Defaults to true. (Track2 has one taxable flag for both taxes.)'),
  taxed2: bool('Accepted for Harvest compatibility; Track2 applies tax2 to every taxed line.'),
})

const createInvoice: Tool = {
  name: 'create_invoice',
  description:
    'Create a free-form DRAFT invoice for a client. `client_id` is required; supply `line_items` for the content. The invoice is created as a draft and is NOT sent; Track2 assigns the invoice number when it is sent from the web app. The response is the same shape `get_invoice` returns. To bill tracked time or expenses use `create_invoice_from_tracked_time`. Requires invoice permission.',
  inputSchema: obj({ client_id: id('Client id the invoice is for (required).'), line_items: { type: 'array', description: 'Invoice line items.', items: lineItemSchema }, ...headerProps }, ['client_id']),
  write: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_invoices', NO_INVOICE_PERMISSION)
    const { accountId } = ctx.user
    const client = await prisma.client.findFirst({ where: { id: String(args.client_id), accountId }, select: { id: true, name: true, currency: true, entityId: true } })
    if (!client) throw notFound('Client')
    const header = await headerData(ctx, args, client.currency)
    const items = (args.line_items as Record<string, unknown>[] | undefined) ?? []
    const itemTypes = await prisma.itemType.findMany({ where: { accountId }, select: { id: true, name: true } })
    const projectIds = [...new Set(items.map((li) => li.project_id).filter((v): v is string => typeof v === 'string'))]
    const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds }, accountId, clientId: client.id }, select: { id: true } }) : []
    const lines = items.map((li, i) => {
      const field = `line_items[${i}]`
      if (li.unit_price === undefined) throw invalid(`${field}.unit_price: is required.`, { field: `${field}.unit_price` })
      const description = String(li.description ?? '').trim()
      if (!description) throw invalid(`${field}.description: is required.`, { field: `${field}.description` })
      const kindName = String(li.kind ?? 'Service')
      const type = itemTypes.find((t) => t.name.toLowerCase() === kindName.toLowerCase())
      if (!type) throw invalid(`${field}.kind: "${kindName}" is not an item type in Track2 (${itemTypes.map((t) => t.name).join(', ')}).`, { field: `${field}.kind` })
      if (li.project_id && !projects.some((p) => p.id === li.project_id)) throw invalid(`${field}.project_id: not a project of this client.`, { field: `${field}.project_id` })
      const quantity = li.quantity === undefined ? 1 : (li.quantity as number)
      const unitPriceCents = centsFromAmount(li.unit_price as number, `${field}.unit_price`, { allowZero: true, allowNegative: true })
      return {
        itemTypeId: type.id,
        description,
        quantity: Math.round(quantity * 100) / 100,
        unitPriceCents,
        amountCents: lineAmountCents(Math.round(quantity * 100) / 100, unitPriceCents),
        taxable: li.taxed === undefined ? true : (li.taxed as boolean),
        linkedProjectId: (li.project_id as string | undefined) ?? null,
      }
    })
    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          accountId,
          clientId: client.id,
          entityId: client.entityId, // routing stamped from the client (specs/16)
          status: 'draft',
          currency: client.currency,
          ...header,
        },
        select: { id: true },
      })
      let sortOrder = 0
      for (const l of lines) {
        await tx.invoiceLineItem.create({ data: { accountId, invoiceId: inv.id, kind: 'free_form', sortOrder: sortOrder++, ...l } })
      }
      await recomputeInvoiceTotals(tx, inv.id)
      return inv
    })
    await writeAudit({ accountId, actorUserId: ctx.user.userId, entityType: 'invoice', entityId: invoice.id, action: 'create', summary: 'Draft created via API (MCP)' })
    return invoiceDetail(ctx, invoice.id)
  },
}

const SUMMARY_TO_GROUPING: Record<string, TimeGrouping> = { detailed: 'detailed', project: 'by_project', task: 'by_task', people: 'by_person' }

const createInvoiceFromTrackedTime: Tool = {
  name: 'create_invoice_from_tracked_time',
  description:
    'Create a DRAFT invoice for a client by importing uninvoiced billable tracked time and/or expenses for the given projects. `client_id` and `project_ids` are required, plus at least one of `time` or `expenses`. When a block omits `from`/`to`, ALL uninvoiced billable activity for those projects is pulled. Fixed-fee projects are billed by their fee, not their hours (Harvest rule): each gets ONE line for its remaining uninvoiced fee and its hours stay uninvoiced. Billable time with no resolvable rate blocks the invoice (`validation_failed` naming the entries). Expenses become one line each (with markup). The invoice is a draft (not sent; the number is assigned on send). Response = `get_invoice` shape. Requires invoice permission.',
  inputSchema: obj(
    {
      client_id: id('Client id the invoice is for (required).'),
      project_ids: ids('Billable project ids (of this client) to import activity from (required).'),
      time: obj(
        {
          summary_type: str('How time line items are grouped.', { enum: ['detailed', 'project', 'task', 'people'] }),
          from: date('Window start (YYYY-MM-DD). Omit to pull all uninvoiced.'),
          to: date('Window end (YYYY-MM-DD). Omit to pull all uninvoiced.'),
        },
        ['summary_type'],
        'Import tracked time (and fixed-fee lines). Omit from/to to pull all uninvoiced billable time.',
      ),
      expenses: obj(
        {
          summary_type: str('Accepted for Harvest compatibility; Track2 always adds one line per expense.', { enum: ['project', 'people', 'category', 'detailed'] }),
          from: date('Window start (YYYY-MM-DD). Omit to pull all uninvoiced.'),
          to: date('Window end (YYYY-MM-DD). Omit to pull all uninvoiced.'),
          attach_receipts: bool('Accepted for Harvest compatibility; ignored.'),
        },
        ['summary_type'],
        'Import billable expenses. Omit from/to to pull all uninvoiced billable expenses.',
      ),
      ...headerProps,
    },
    ['client_id', 'project_ids'],
  ),
  write: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_invoices', NO_INVOICE_PERMISSION)
    const { accountId } = ctx.user
    const time = args.time as { summary_type: string; from?: string; to?: string } | undefined
    const expenses = args.expenses as { from?: string; to?: string } | undefined
    if (!time && !expenses) throw invalid('Provide at least one of `time` or `expenses`.', { field: 'time' })
    const client = await prisma.client.findFirst({ where: { id: String(args.client_id), accountId }, select: { id: true, currency: true } })
    if (!client) throw notFound('Client')
    const projectIds = args.project_ids as string[]
    const projects = await prisma.project.findMany({ where: { id: { in: projectIds }, accountId, clientId: client.id }, select: { id: true } })
    const missing = projectIds.filter((p) => !projects.some((x) => x.id === p))
    if (missing.length) throw invalid(`project_ids: ${missing.join(', ')} ${missing.length === 1 ? 'is not a project' : 'are not projects'} of this client.`, { field: 'project_ids' })
    const header = await headerData(ctx, args, client.currency)
    const win = (b: { from?: string; to?: string } | undefined, label: string) => {
      const from = dateArg(b?.from, `${label}.from`)
      const to = dateArg(b?.to, `${label}.to`)
      if (from && to && from > to) throw invalid(`${label}.from must be on or before ${label}.to.`, { field: `${label}.from` })
      return { from, to }
    }
    const tw = win(time, 'time')
    const ew = win(expenses, 'expenses')
    let invoice: { id: string } | null
    try {
      invoice = await generateInvoice(prisma, {
        accountId,
        clientId: client.id,
        projectIds,
        grouping: time ? SUMMARY_TO_GROUPING[time.summary_type] : undefined,
        includeTime: !!time,
        includeExpenses: !!expenses,
        timeFrom: tw.from,
        timeTo: tw.to,
        expenseFrom: ew.from,
        expenseTo: ew.to,
      })
    } catch (e) {
      if (e instanceof GenerateInvoiceError) throw invalid(e.message)
      throw e
    }
    if (!invoice) throw invalid('Nothing to invoice: no uninvoiced billable time, expenses or remaining fixed fee for those projects in that window.')
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice!.id }, data: header })
      await recomputeInvoiceTotals(tx, invoice!.id)
    })
    await writeAudit({ accountId, actorUserId: ctx.user.userId, entityType: 'invoice', entityId: invoice.id, action: 'create', summary: 'Draft generated from tracked time via API (MCP)' })
    return invoiceDetail(ctx, invoice.id)
  },
}

export const invoiceTools: Tool[] = [listInvoices, getInvoice, createInvoice, createInvoiceFromTrackedTime]

/**
 * Fixed-fee invoicing, Harvest-exact (specs/05-invoicing.md §Fixed-fee projects, AC-INV-003*).
 *
 * Harvest bills a Fixed Fee project by its FEE, never by its hours:
 *  - Generating an invoice for a fixed-fee project adds ONE line for the project's remaining
 *    uninvoiced fee = project fee − amount already invoiced for that project. Nothing remaining → no line.
 *  - The line's unit price is editable on the draft. Lowering it (e.g. $1,000 → $600) leaves the
 *    difference ($400) to be pulled onto a later invoice, because "invoiced so far" is always
 *    re-derived from the line items linked to the project (InvoiceLineItem.linkedProjectId).
 *  - Hours tracked on a fixed-fee project are NOT linked to the invoice; they stay uninvoiced hours.
 *  - Reports/cards: a fixed-fee project's uninvoiced AMOUNT is fee − invoiced (not hours × rate).
 *
 * What counts as "invoiced" for a project (our documented choice, matching Harvest where an invoice
 * exists until it is deleted): the sum of `amountCents` of every line linked to the project on ANY
 * existing invoice — draft, open, paid, closed and written off alike — except `expense` lines
 * (billable expenses are invoiced on top of the fee, as in Harvest). Deleting a draft (or sent)
 * invoice deletes its lines, so its amount returns to the remaining fee. Drafts count so two drafts
 * can never both claim the same remaining fee.
 *
 * The project fee is `projectFeesCents` (Harvest "Project fees"; the importer maps Harvest's `fee`),
 * falling back to a `fee_total` budget value for projects that only carry the fee as a budget.
 */
import { Prisma } from '@prisma/client'
import type { GeneratedLineItem } from './lineItems'

export interface FixedFeeProjectFee {
  projectFeesCents: number | null
  budgetMethod?: string | null
  budgetValue?: number | null
}

/** The project's total fee in cents ("Total project fees"), or null if none is set. */
export function projectFeeCents(p: FixedFeeProjectFee): number | null {
  if (p.projectFeesCents != null) return p.projectFeesCents
  if (p.budgetMethod === 'fee_total' && p.budgetValue != null) return p.budgetValue
  return null
}

/** Remaining uninvoiced fee: fee − invoiced, floored at 0 (an over-invoiced project has nothing left). */
export function remainingFeeCents(feeCents: number | null, invoicedCents: number): number {
  if (feeCents == null) return 0
  return Math.max(0, feeCents - invoicedCents)
}

/** Lines that count toward a fixed-fee project's invoiced amount (see header). */
export function countsTowardFee(line: { kind: string; linkedProjectId: string | null }, projectId: string): boolean {
  return line.linkedProjectId === projectId && line.kind !== 'expense'
}

/** Sum of the amounts already invoiced for `projectId` from a list of line items (pure mirror of the SQL). */
export function invoicedForProject(
  lines: { kind: string; linkedProjectId: string | null; amountCents: number }[],
  projectId: string,
): number {
  return lines.reduce((s, l) => (countsTowardFee(l, projectId) ? s + l.amountCents : s), 0)
}

export interface FixedFeeLineProject {
  id: string
  name: string
  feeCents: number | null
}

/**
 * The single fixed-fee line for a project on a generated invoice, or null when nothing remains.
 * Quantity 1 × the remaining fee; no time entries are attached (they stay uninvoiced hours).
 */
export function fixedFeeLine(project: FixedFeeLineProject, invoicedCents: number): GeneratedLineItem | null {
  const remaining = remainingFeeCents(project.feeCents, invoicedCents)
  if (remaining <= 0) return null
  return {
    kind: 'flat',
    description: project.name,
    quantityHours: 1,
    unitPriceCents: remaining,
    amountCents: remaining,
    linkedProjectId: project.id,
    sourceEntryIds: [],
  }
}

export interface FixedFeeStatus {
  projectId: string
  clientId: string
  name: string
  code: string | null
  notes: string | null
  feeCents: number | null
  invoicedCents: number
  remainingCents: number
}

type RawDb = { $queryRaw: <T = unknown>(query: Prisma.Sql) => Prisma.PrismaPromise<T> }

/**
 * Fee / invoiced / remaining for the account's fixed-fee projects, aggregated in the DB (one pass over
 * the linked line items). Filters: explicit `projectIds`, a `clientId`, active-only, and
 * `excludeInvoiceId` (leave one invoice's lines out, e.g. the draft being edited).
 */
export async function fixedFeeStatus(
  db: RawDb,
  accountId: string,
  opts: { projectIds?: string[]; clientId?: string; activeOnly?: boolean; excludeInvoiceId?: string } = {},
): Promise<FixedFeeStatus[]> {
  if (opts.projectIds && opts.projectIds.length === 0) return []
  const rows = await db.$queryRaw<
    { projectId: string; clientId: string; name: string; code: string | null; notes: string | null; fee: number | null; invoiced: bigint }[]
  >(Prisma.sql`
    WITH ff AS (
      SELECT p.id, p."clientId", p.name, p.code, p.notes,
        COALESCE(p."projectFeesCents", CASE WHEN p."budgetMethod"::text = 'fee_total' THEN p."budgetValue" END) AS fee
      FROM "Project" p
      WHERE p."accountId" = ${accountId} AND p."projectType"::text = 'fixed_fee'
        ${opts.projectIds ? Prisma.sql`AND p.id IN (${Prisma.join(opts.projectIds)})` : Prisma.empty}
        ${opts.clientId ? Prisma.sql`AND p."clientId" = ${opts.clientId}` : Prisma.empty}
        ${opts.activeOnly ? Prisma.sql`AND p."isActive" = true AND p."archivedAt" IS NULL` : Prisma.empty}
    ),
    inv AS (
      SELECT li."linkedProjectId" AS pid, SUM(li."amountCents") AS c
      FROM "InvoiceLineItem" li
      WHERE li."accountId" = ${accountId} AND li."linkedProjectId" IN (SELECT id FROM ff) AND li.kind::text <> 'expense'
        ${opts.excludeInvoiceId ? Prisma.sql`AND li."invoiceId" <> ${opts.excludeInvoiceId}` : Prisma.empty}
      GROUP BY li."linkedProjectId"
    )
    SELECT ff.id AS "projectId", ff."clientId", ff.name, ff.code, ff.notes, ff.fee, COALESCE(inv.c, 0)::bigint AS invoiced
    FROM ff LEFT JOIN inv ON inv.pid = ff.id
    ORDER BY ff.name`)
  return rows.map((r) => {
    const feeCents = r.fee == null ? null : Number(r.fee)
    const invoicedCents = Number(r.invoiced)
    return {
      projectId: r.projectId,
      clientId: r.clientId,
      name: r.name,
      code: r.code,
      notes: r.notes,
      feeCents,
      invoicedCents,
      remainingCents: remainingFeeCents(feeCents, invoicedCents),
    }
  })
}

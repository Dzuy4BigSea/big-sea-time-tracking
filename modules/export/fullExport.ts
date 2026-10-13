import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Admin full data export (Settings → Data export). One streamed CSV per table, every column except
 * secrets, scoped to the caller's account (INV-5) and keyset-paginated by primary key so the 388k
 * time entries never sit in memory.
 */

export const EXPORT_TABLES = {
  'time-entries': { table: 'TimeEntry', label: 'Time entries' },
  invoices: { table: 'Invoice', label: 'Invoices' },
  'invoice-line-items': { table: 'InvoiceLineItem', label: 'Invoice line items' },
  payments: { table: 'Payment', label: 'Payments' },
  clients: { table: 'Client', label: 'Clients' },
  contacts: { table: 'ClientContact', label: 'Client contacts' },
  projects: { table: 'Project', label: 'Projects' },
  people: { table: 'User', label: 'People' },
  expenses: { table: 'Expense', label: 'Expenses' },
} as const

export type ExportTableKey = keyof typeof EXPORT_TABLES

export function isExportTable(k: string): k is ExportTableKey {
  return Object.prototype.hasOwnProperty.call(EXPORT_TABLES, k)
}

/** Columns never exported: password hashes, capability tokens, anything secret. */
export function isSecretColumn(name: string): boolean {
  return /password|secret|token|hash/i.test(name)
}

export type ExportColumn = { name: string; dataType: string }

/** Column list from the live schema (so new columns are exported without code changes). */
export async function exportColumns(table: string): Promise<ExportColumn[]> {
  const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    table,
  )
  return cols.filter((c) => !isSecretColumn(c.column_name)).map((c) => ({ name: c.column_name, dataType: c.data_type }))
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`

/** Every value comes back as text: ISO dates/timestamps, JSON/arrays/numerics in Postgres text form. */
function selectExpr(c: ExportColumn): string {
  const col = ident(c.name)
  if (c.dataType === 'date') return `to_char(${col}, 'YYYY-MM-DD') AS ${col}`
  if (c.dataType.startsWith('timestamp')) return `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${col}`
  return `${col}::text AS ${col}`
}

/** Async batches of rows (arrays of cells, in `columns` order) for one account's table. */
export async function* exportTableBatches(table: string, columns: ExportColumn[], accountId: string, batchSize: number): AsyncGenerator<unknown[][]> {
  if (!columns.some((c) => c.name === 'accountId') || !columns.some((c) => c.name === 'id')) {
    throw new Error(`Table ${table} is not account-scoped; refusing to export.`)
  }
  const select = columns.map(selectExpr).join(', ')
  const t = ident(table)
  let after: string | null = null
  for (;;) {
    const rows: Record<string, string | null>[] = after == null
      ? await prisma.$queryRawUnsafe(`SELECT ${select} FROM ${t} WHERE "accountId" = $1 ORDER BY "id" LIMIT ${batchSize}`, accountId)
      : await prisma.$queryRawUnsafe(`SELECT ${select} FROM ${t} WHERE "accountId" = $1 AND "id" > $2 ORDER BY "id" LIMIT ${batchSize}`, accountId, after)
    if (!rows.length) return
    yield rows.map((r) => columns.map((c) => r[c.name]))
    if (rows.length < batchSize) return
    after = String(rows[rows.length - 1].id)
  }
}

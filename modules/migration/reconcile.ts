/**
 * Migration reconciliation (spec 13) — pure, DB-free.
 *
 * After an import phase runs, we compare three numbers per entity to confirm the migration is
 * faithful and to make discrepancies visible instead of silent:
 *   - sourceRows: how many rows the captured Harvest snapshot holds for this resource
 *   - mappedIds:  how many MigrationIdMap entries exist (created OR matched to an existing record)
 *   - dbRows:     how many rows actually live in the Track2 table for this account
 *
 * A row can legitimately be *skipped* (an orphan whose parent wasn't imported — e.g. a time entry
 * for a project outside the phase, or a contact for a missing client). Skips are expected while a
 * migration is only partially staged, so `expectedSkips` lets a phase declare a tolerated gap; the
 * reconciler flags anything beyond it.
 */

export type ReconRow = {
  entity: string
  label: string
  sourceRows: number
  mappedIds: number
  dbRows: number
  /** sourceRows - mappedIds: source rows that produced no id-map entry (skipped/errored) */
  unmapped: number
  status: 'ok' | 'partial' | 'mismatch' | 'pending'
  note: string
}

export type ReconInput = {
  entity: string
  label: string
  /** the snapshot resource key this entity is built from (for source count lookup) */
  resource: string
  sourceRows: number
  mappedIds: number
  dbRows: number
  /** rows we expect not to map in this phase (orphans by design). Default 0. */
  expectedSkips?: number
  /** true when this entity's stage has run in the phase under review; false → 'pending' */
  ran: boolean
}

export function reconcileEntity(i: ReconInput): ReconRow {
  const unmapped = Math.max(0, i.sourceRows - i.mappedIds)
  const tolerated = i.expectedSkips ?? 0
  let status: ReconRow['status']
  let note = ''

  if (!i.ran) {
    status = 'pending'
    note = 'stage not run in this phase'
  } else if (i.sourceRows === 0) {
    status = 'ok'
    note = 'no source rows'
  } else if (i.mappedIds >= i.sourceRows) {
    // Every source row mapped (created or matched an existing record).
    status = 'ok'
    note = i.mappedIds > i.sourceRows ? `${i.mappedIds - i.sourceRows} extra mapped (pre-existing?)` : 'all rows mapped'
  } else if (unmapped <= tolerated) {
    status = 'partial'
    note = `${unmapped} unmapped within tolerance (${tolerated})`
  } else {
    status = 'mismatch'
    note = `${unmapped} source rows did not map (tolerance ${tolerated})`
  }

  return { entity: i.entity, label: i.label, sourceRows: i.sourceRows, mappedIds: i.mappedIds, dbRows: i.dbRows, unmapped, status, note }
}

export function reconcile(inputs: ReconInput[]): { rows: ReconRow[]; ok: boolean } {
  const rows = inputs.map(reconcileEntity)
  const ok = rows.every((r) => r.status === 'ok' || r.status === 'partial' || r.status === 'pending')
  return { rows, ok }
}

/** Render a reconciliation report as an aligned text table for CLI output / logs. */
export function formatReconTable(rows: ReconRow[]): string {
  const head = ['entity', 'source', 'mapped', 'db', 'unmapped', 'status', 'note']
  const body = rows.map((r) => [r.label, String(r.sourceRows), String(r.mappedIds), String(r.dbRows), String(r.unmapped), r.status, r.note])
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((row) => row[c].length)))
  const line = (cols: string[]) => cols.map((v, c) => v.padEnd(widths[c])).join('  ')
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}

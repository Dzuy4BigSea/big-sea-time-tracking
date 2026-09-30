/**
 * Delta ("incremental") backup high-water mark.
 *
 * Harvest returns 403 for /estimates on Big Sea's plan, so every backup finishes "partial" on that
 * alone — which used to mean lastPulledAt was never saved and the Incremental button stayed locked.
 * A pull whose only failures are non-blocking resources is still a clean high-water mark.
 */
const NON_BLOCKING_RESOURCES = new Set(['estimates'])

/** True when every failed work key (`resource|chunk`) is for a resource we can live without. */
export function isCleanPull(errorKeys: string[]): boolean {
  return errorKeys.every((k) => NON_BLOCKING_RESOURCES.has(k.split('|')[0]))
}

export interface SnapshotLike {
  status: string
  mode: string
  createdAt: Date
  meta: unknown
}

/**
 * Where an incremental pull should start: the connection's saved lastPulledAt, else the start of the
 * newest finished full backup (complete or partial — its gaps exist either way; a delta from its
 * start doesn't widen them). Null when there's no finished full backup to delta from.
 */
export function resolveDeltaSince(lastPulledAt: string | null | undefined, snapshots: SnapshotLike[]): string | null {
  if (lastPulledAt) return lastPulledAt
  const base = [...snapshots]
    .filter((s) => s.mode === 'full' && (s.status === 'complete' || s.status === 'partial'))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  if (!base) return null
  const startedAt = (base.meta as { startedAt?: string } | null)?.startedAt
  return startedAt ?? base.createdAt.toISOString()
}

import 'server-only'
import { prisma } from '@/lib/prisma'
import type { AuditAction, Prisma } from '@prisma/client'

/**
 * Append an entry to the activity log (specs/07/08/17). Best-effort — auditing must never break the
 * business action, so failures are swallowed. `summary` is a human-readable line for the timeline;
 * `detail` optionally carries structured before/after context.
 */
// Time entries write their audit rows inside the same transaction as the change, through the pure
// builder modules/time/timeAudit.ts (tx.auditLog.create), so a committed edit/delete always has one.
export async function writeAudit(input: {
  accountId: string
  actorUserId?: string | null
  entityType: string
  entityId: string
  action: AuditAction
  summary: string
  detail?: Record<string, unknown>
  /** Optional prior state, stored in the `before` column (after = summary + detail). */
  before?: Record<string, unknown>
  /** Override the entry timestamp — used when back-dating imported historical events. */
  at?: Date
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        accountId: input.accountId,
        actorUserId: input.actorUserId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        ...(input.before ? { before: input.before as Prisma.InputJsonValue } : {}),
        after: { summary: input.summary, ...(input.detail ?? {}) } as Prisma.InputJsonValue,
        ...(input.at ? { createdAt: input.at } : {}),
      },
    })
  } catch {
    /* logging must never break the flow */
  }
}

export interface AuditEntry {
  id: string
  action: AuditAction
  summary: string
  actorName: string | null
  createdAt: Date
}

/** Activity for one entity, newest first, with a resolved actor name + summary line. */
export async function listAudit(accountId: string, entityType: string, entityId: string, take = 50): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { accountId, entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { actor: { select: { firstName: true, lastName: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: (r.after as { summary?: string } | null)?.summary ?? r.action,
    actorName: r.actor ? `${r.actor.firstName} ${r.actor.lastName}`.trim() : null,
    createdAt: r.createdAt,
  }))
}

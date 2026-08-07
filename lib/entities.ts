import 'server-only'
import { prisma } from '@/lib/prisma'
import type { BusinessEntity } from '@prisma/client'

/** Active entities for an account, default first (specs/16). */
export async function listEntities(accountId: string): Promise<BusinessEntity[]> {
  return prisma.businessEntity.findMany({
    where: { accountId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
}

/** The account's default (fallback) entity — Big Sea. */
export async function getDefaultEntity(accountId: string): Promise<BusinessEntity | null> {
  return prisma.businessEntity.findFirst({ where: { accountId, isDefault: true } })
}

/** A single entity scoped to the account (null if not found / other tenant). */
export async function getEntity(accountId: string, entityId: string | null | undefined): Promise<BusinessEntity | null> {
  if (!entityId) return null
  return prisma.businessEntity.findFirst({ where: { id: entityId, accountId } })
}

/**
 * Resolve the effective entity for an invoice: its own stamp, else the client's designation, else the
 * account default. Returns the full entity row (or null if the account has no entities yet).
 */
export async function resolveInvoiceEntityRow(
  accountId: string,
  opts: { invoiceEntityId?: string | null; clientEntityId?: string | null },
): Promise<BusinessEntity | null> {
  const id = opts.invoiceEntityId ?? opts.clientEntityId ?? null
  if (id) {
    const row = await getEntity(accountId, id)
    if (row) return row
  }
  return getDefaultEntity(accountId)
}

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

/** Return the entity id only if it belongs to this account (else null) — for validating form input. */
export async function validEntityId(accountId: string, entityId: string | null | undefined): Promise<string | null> {
  if (!entityId) return null
  const e = await prisma.businessEntity.findFirst({ where: { id: entityId, accountId }, select: { id: true } })
  return e?.id ?? null
}

/**
 * The effective entity id for a stored invoice: its own stamp, else the client's designation, else
 * the account default. Used by Stripe/Xero routing so payments land in the right company's account.
 */
export async function entityIdForInvoice(accountId: string, invoiceId: string): Promise<string | null> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: { entityId: true, client: { select: { entityId: true } } },
  })
  if (!inv) return null
  if (inv.entityId) return inv.entityId
  if (inv.client?.entityId) return inv.client.entityId
  const def = await getDefaultEntity(accountId)
  return def?.id ?? null
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

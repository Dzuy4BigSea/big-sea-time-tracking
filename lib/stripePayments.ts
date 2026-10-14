import 'server-only'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { entityIdForInvoice } from '@/lib/entities'

/**
 * The Stripe connection that takes payment for an invoice (specs/16): the invoice's business entity
 * (invoice stamp → client → account default), falling back to the shared row only when the entity
 * has none. The public page (Pay button, return banner) and the checkout action both use this, so
 * the button never shows for a connection the checkout won't use.
 */
export async function stripeForInvoice(
  accountId: string,
  invoiceId: string,
): Promise<{ entityId: string | null; config: Record<string, unknown>; secretKey: string } | null> {
  const entityId = await entityIdForInvoice(accountId, invoiceId)
  const conn = await getConnectionWithSecrets(accountId, 'stripe', entityId)
  const secretKey = conn?.secrets.secretKey
  if (!conn || conn.status !== 'connected' || !secretKey) return null
  return { entityId, config: conn.config, secretKey }
}

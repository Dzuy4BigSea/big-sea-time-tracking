import { prisma } from '@/lib/prisma'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { handleSendGridWebhook, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/modules/email/sendgridWebhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * SendGrid Signed Event Webhook → invoice trace (OPS.md "Email deliverability").
 * Configure in SendGrid → Settings → Mail Settings → Event Webhook:
 *   POST URL https://track2.bigseabridge.com/api/email/events, signature verification ON,
 *   public key → Vercel env SENDGRID_WEBHOOK_PUBLIC_KEY.
 * Not behind the auth middleware (its matcher skips /api); authenticity is the ECDSA signature.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const res = await handleSendGridWebhook(
    {
      rawBody,
      signature: request.headers.get(SIGNATURE_HEADER),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
    },
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY,
    {
      invoiceInAccount: async (invoiceId, accountId) =>
        !!(await prisma.invoice.findFirst({ where: { id: invoiceId, accountId }, select: { id: true } })),
      record: (e) => recordInvoiceEvent(e),
    },
  )
  return Response.json(res.body, { status: res.status })
}

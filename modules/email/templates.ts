import 'server-only'

/** Escape user-supplied text before interpolating into email HTML. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

/** Email header/accent theme. Per-company colors (spec 18) resolve into this; the default is
 * Track2's dark + lime, which every company inherits until it themes its emails. */
export interface EmailTheme {
  brandColor: string
  accentColor: string
}
export const DEFAULT_EMAIL_THEME: EmailTheme = { brandColor: '#0d2022', accentColor: '#bbfd50' }

const shell = (label: string, body: string, theme: EmailTheme = DEFAULT_EMAIL_THEME) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f7f8f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f8;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="8" style="width:8px;background:${theme.accentColor};font-size:0;line-height:0;">&nbsp;</td>
<td style="background:${theme.brandColor};padding:22px 30px;color:${theme.accentColor};font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">${esc(label)}</td>
</tr></table></td></tr>
<tr><td style="padding:30px;">${body}</td></tr>
<tr><td style="background:#f7f8f8;padding:18px 30px;border-top:1px solid #e5e7eb;font-size:12px;color:#605f56;">Sent by Track2. Questions? Just reply to this email.</td></tr>
</table></td></tr></table></body></html>`

/** Invoice-sent email (spec 15 E-invoice). `amountDue` etc. are pre-formatted strings. */
export function renderInvoiceSentEmail(v: {
  fromName: string
  clientName: string
  invoiceNumber: string
  amountDue: string
  issueDate: string
  dueDate: string
  payUrl: string | null
  invoiceUrl: string
  msg?: { subject?: string; intro?: string }
  theme?: EmailTheme
}): { subject: string; html: string } {
  const t = v.theme ?? DEFAULT_EMAIL_THEME
  const cta = v.payUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#047a44;"><a href="${v.payUrl}" style="display:block;padding:13px 28px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">Pay ${esc(v.amountDue)}</a></td></tr></table>
       <p style="margin:14px 0 0;font-size:13px;color:#605f56;">or <a href="${v.invoiceUrl}" style="color:${t.brandColor};">view the invoice</a></p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${t.brandColor};"><a href="${v.invoiceUrl}" style="display:block;padding:13px 28px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">View invoice</a></td></tr></table>`
  const intro = v.msg?.intro?.trim() || `Hi ${v.clientName} — here's your invoice from ${v.fromName}.`
  const body = `
    <h1 style="margin:0 0 6px;font-size:24px;color:#0d2022;">Invoice ${esc(v.invoiceNumber)}</h1>
    <p style="margin:0 0 18px;font-size:15px;color:#3f4a4b;line-height:24px;">${esc(intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:20px;"><tr><td style="padding:18px 22px;">
      <div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#605f56;">Amount due</div>
      <div style="font-size:30px;font-weight:bold;color:${t.brandColor};">${esc(v.amountDue)}</div>
      <div style="font-size:13px;color:#605f56;margin-top:6px;">Issued ${esc(v.issueDate)} · Due ${esc(v.dueDate)}</div>
    </td></tr></table>
    ${cta}`
  const subject = v.msg?.subject?.trim() || `Invoice ${v.invoiceNumber} from ${v.fromName}`
  return { subject, html: shell('Invoice', body, t) }
}

/** Payment-received receipt (spec 15). */
export function renderPaymentReceiptEmail(v: {
  fromName: string
  clientName: string
  invoiceNumber: string
  amountPaid: string
  paidDate: string
  method: string
  msg?: { subject?: string; intro?: string }
  theme?: EmailTheme
}): { subject: string; html: string } {
  const t = v.theme ?? DEFAULT_EMAIL_THEME
  const intro = v.msg?.intro?.trim() || `Thanks, ${v.clientName} — invoice ${v.invoiceNumber} is settled. Nothing further needed.`
  const body = `
    <h1 style="margin:0 0 6px;font-size:24px;color:#0d2022;">Payment received</h1>
    <p style="margin:0 0 18px;font-size:15px;color:#3f4a4b;line-height:24px;">${esc(intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;"><tr><td style="padding:18px 22px;">
      <div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#047a44;">Paid in full</div>
      <div style="font-size:30px;font-weight:bold;color:#047a44;">${esc(v.amountPaid)}</div>
      <div style="font-size:13px;color:#605f56;margin-top:6px;">Invoice ${esc(v.invoiceNumber)} · ${esc(v.paidDate)} · ${esc(v.method)}</div>
    </td></tr></table>
    <p style="margin:16px 0 0;font-size:13px;color:#605f56;">Keep this email for your records — it doubles as the receipt.</p>`
  const subject = v.msg?.subject?.trim() || `Payment received — invoice ${v.invoiceNumber}`
  return { subject, html: shell('Receipt', body, t) }
}

/** Overdue payment reminder (spec 15 E3). */
export function renderOverdueReminderEmail(v: {
  fromName: string
  clientName: string
  invoiceNumber: string
  amountDue: string
  dueDate: string
  daysOverdue: number
  payUrl: string | null
  invoiceUrl: string
  msg?: { subject?: string; intro?: string }
  theme?: EmailTheme
}): { subject: string; html: string } {
  const t = v.theme ?? DEFAULT_EMAIL_THEME
  const cta = v.payUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#c9342c;"><a href="${v.payUrl}" style="display:block;padding:13px 28px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">Pay ${esc(v.amountDue)}</a></td></tr></table>`
    : `<a href="${v.invoiceUrl}" style="color:#004348;font-weight:bold;">View the invoice</a>`
  const intro = v.msg?.intro?.trim() || `Hi ${v.clientName} — a friendly nudge that this was due on ${v.dueDate}. If it's already in your payment run, thank you — please ignore.`
  const body = `
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffecea;border-radius:20px;padding:5px 12px;font-size:12px;font-weight:bold;color:#c9342c;">${v.daysOverdue} days past due</td></tr></table>
    <h1 style="margin:14px 0 6px;font-size:24px;color:#0d2022;">Invoice ${esc(v.invoiceNumber)}</h1>
    <p style="margin:0 0 18px;font-size:15px;color:#3f4a4b;line-height:24px;">${esc(intro)}</p>
    <div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#605f56;">Amount due</div>
    <div style="font-size:30px;font-weight:bold;color:#c9342c;margin-bottom:16px;">${esc(v.amountDue)}</div>
    ${cta}`
  const subject = v.msg?.subject?.trim() || `Reminder: invoice ${v.invoiceNumber} is ${v.daysOverdue} days past due`
  return { subject, html: shell('Payment reminder', body, t) }
}

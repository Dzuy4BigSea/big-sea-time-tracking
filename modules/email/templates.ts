import 'server-only'

/** Escape user-supplied text before interpolating into email HTML. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

const shell = (label: string, body: string) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f7f8f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f8;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="8" style="width:8px;background:#bbfd50;font-size:0;line-height:0;">&nbsp;</td>
<td style="background:#0d2022;padding:22px 30px;color:#bbfd50;font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">${esc(label)}</td>
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
}): { subject: string; html: string } {
  const cta = v.payUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#047a44;"><a href="${v.payUrl}" style="display:block;padding:13px 28px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">Pay ${esc(v.amountDue)}</a></td></tr></table>
       <p style="margin:14px 0 0;font-size:13px;color:#605f56;">or <a href="${v.invoiceUrl}" style="color:#004348;">view the invoice</a></p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#004348;"><a href="${v.invoiceUrl}" style="display:block;padding:13px 28px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">View invoice</a></td></tr></table>`
  const body = `
    <h1 style="margin:0 0 6px;font-size:24px;color:#0d2022;">Invoice ${esc(v.invoiceNumber)}</h1>
    <p style="margin:0 0 18px;font-size:15px;color:#3f4a4b;line-height:24px;">Hi ${esc(v.clientName)} — here's your invoice from ${esc(v.fromName)}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:20px;"><tr><td style="padding:18px 22px;">
      <div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#605f56;">Amount due</div>
      <div style="font-size:30px;font-weight:bold;color:#004348;">${esc(v.amountDue)}</div>
      <div style="font-size:13px;color:#605f56;margin-top:6px;">Issued ${esc(v.issueDate)} · Due ${esc(v.dueDate)}</div>
    </td></tr></table>
    ${cta}`
  return { subject: `Invoice ${v.invoiceNumber} from ${v.fromName}`, html: shell('Invoice', body) }
}

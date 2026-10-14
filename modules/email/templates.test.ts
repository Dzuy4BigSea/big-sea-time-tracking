import { describe, it, expect } from 'vitest'
import { renderInvoiceSentEmail, renderOverdueReminderEmail, renderPaymentReceiptEmail } from './templates'
import { foreignLinkHosts } from './sendgrid'

const URL_ = 'https://track2.bigseabridge.com/i/abc123'
const inv = { fromName: 'Big Sea', clientName: 'Acme <Co>', invoiceNumber: '1042', amountDue: '$1,200.00', issueDate: 'Oct 1, 2026', dueDate: 'Oct 31, 2026', payUrl: URL_, invoiceUrl: URL_ }

describe('client email templates (deliverability)', () => {
  const all = [
    renderInvoiceSentEmail(inv),
    renderOverdueReminderEmail({ ...inv, daysOverdue: 3 }),
    renderPaymentReceiptEmail({ fromName: 'Big Sea', clientName: 'Acme', invoiceNumber: '1042', amountPaid: '$1,200.00', paidDate: 'Oct 9, 2026', method: 'card' }),
  ]

  it('every email has a plain-text part with the real content', () => {
    for (const e of all) {
      expect(e.text.length).toBeGreaterThan(40)
      expect(e.text).not.toMatch(/<(table|td|a|p|div|h1)\b/i) // no markup leaks into the text part
      expect(e.text).not.toContain('&lt;') // and no HTML escaping either
      expect(e.text).toContain('1042')
    }
    expect(all[0].text).toContain(URL_)
    expect(all[1].text).toContain(URL_)
  })

  it('links only point at the Track2 public invoice URL (no shorteners or third-party hosts)', () => {
    for (const e of all) expect(foreignLinkHosts(e.html, ['track2.bigseabridge.com'])).toEqual([])
  })

  it('is not image-only (no <img>, real text in the HTML)', () => {
    for (const e of all) {
      expect(e.html).not.toMatch(/<img/i)
      expect(e.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').length).toBeGreaterThan(100)
    }
  })

  it('escapes client names in HTML', () => {
    expect(all[0].html).toContain('Acme &lt;Co&gt;')
  })

  it('subjects are sensible and pluralized', () => {
    expect(all[0].subject).toBe('Invoice 1042 from Big Sea')
    expect(renderOverdueReminderEmail({ ...inv, daysOverdue: 1 }).subject).toBe('Reminder: invoice 1042 is 1 day past due')
    expect(renderOverdueReminderEmail({ ...inv, daysOverdue: 0 }).subject).toBe('Reminder: invoice 1042 is due Oct 31, 2026')
  })
})

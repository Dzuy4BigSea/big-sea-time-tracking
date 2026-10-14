import { describe, it, expect } from 'vitest'
import { invoiceRecipients, reminderMessage, recipientSummary } from './compose'

describe('invoiceRecipients', () => {
  it('emails every flagged invoice recipient, not just the first', () => {
    expect(
      invoiceRecipients([
        { email: 'pm@client.com', isInvoiceRecipient: false },
        { email: 'ap@client.com', isInvoiceRecipient: true },
        { email: 'cfo@client.com', isInvoiceRecipient: true },
        { email: 'AP@client.com', isInvoiceRecipient: true },
        { email: null, isInvoiceRecipient: true },
      ]),
    ).toEqual(['ap@client.com', 'cfo@client.com'])
  })
  it('falls back to the first contact with an email when none is flagged', () => {
    expect(invoiceRecipients([{ email: null, isInvoiceRecipient: false }, { email: 'a@c.com', isInvoiceRecipient: false }, { email: 'b@c.com', isInvoiceRecipient: false }])).toEqual(['a@c.com'])
  })
  it('a flagged contact without an email does not block the fallback', () => {
    expect(invoiceRecipients([{ email: '', isInvoiceRecipient: true }, { email: 'a@c.com', isInvoiceRecipient: false }])).toEqual(['a@c.com'])
  })
  it('no contacts → nobody', () => {
    expect(invoiceRecipients([])).toEqual([])
  })
})

describe('reminderMessage', () => {
  const builtIn = { subject: 'Reminder: {days} days past due', body: 'was due on {due}' }
  it('uses the built-in "past due" wording only when actually late', () => {
    expect(reminderMessage(builtIn, builtIn, true)).toEqual({ subject: builtIn.subject, intro: builtIn.body })
    expect(reminderMessage(builtIn, builtIn, false)).toEqual({ subject: undefined, intro: undefined })
  })
  it('always honours a customized template', () => {
    const custom = { subject: 'Friendly nudge {number}', body: 'Hello' }
    expect(reminderMessage(custom, builtIn, false)).toEqual({ subject: custom.subject, intro: custom.body })
  })
})

describe('recipientSummary', () => {
  it('summarizes', () => {
    expect(recipientSummary(['a@x.com'])).toBe('a@x.com')
    expect(recipientSummary(['a@x.com', 'b@x.com'])).toBe('a@x.com and 1 other')
    expect(recipientSummary(['a@x.com', 'b@x.com', 'c@x.com'])).toBe('a@x.com and 2 others')
  })
})

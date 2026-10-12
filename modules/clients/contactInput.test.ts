import { describe, it, expect } from 'vitest'
import { parseContactForm } from './contactInput'

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

describe('parseContactForm', () => {
  it('normalizes and trims every field; blanks become null', () => {
    const r = parseContactForm(
      form({ firstName: ' Ada ', lastName: 'Lovelace ', title: ' CFO', email: ' ada@example.com ', phoneOffice: '', phoneMobile: ' 555-1234 ', isInvoiceRecipient: 'on' }),
    )
    expect(r).toEqual({
      ok: true,
      data: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        title: 'CFO',
        email: 'ada@example.com',
        phoneOffice: null,
        phoneMobile: '555-1234',
        isInvoiceRecipient: true,
      },
    })
  })

  it('requires a first or last name', () => {
    const r = parseContactForm(form({ firstName: ' ', lastName: '', email: 'x@y.co' }))
    expect(r.ok).toBe(false)
  })

  it('accepts a last name only (first name falls back to the em dash placeholder)', () => {
    const r = parseContactForm(form({ lastName: 'Smith' }))
    expect(r.ok && r.data.firstName).toBe('—')
    expect(r.ok && r.data.isInvoiceRecipient).toBe(false)
  })

  it('rejects a malformed email', () => {
    const r = parseContactForm(form({ firstName: 'A', email: 'not-an-email' }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('email') })
  })

  it('caps overly long values', () => {
    const r = parseContactForm(form({ firstName: 'x'.repeat(500) }))
    expect(r.ok && r.data.firstName.length).toBe(200)
  })

  it('keeps an unchanged stored email even if it would fail validation (migrated contacts)', () => {
    expect(parseContactForm(form({ firstName: 'A', email: 'billing@acme' }), 'billing@acme').ok).toBe(true)
    expect(parseContactForm(form({ firstName: 'A', email: 'new@acme' }), 'billing@acme').ok).toBe(false)
  })
})

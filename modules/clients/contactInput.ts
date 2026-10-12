/**
 * Client contact form parsing/validation (BugHerd #3 — add/edit points of contact per client).
 * Pure: takes a FormData-like getter, returns the normalized ClientContact fields or an error.
 */

export interface ContactFields {
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phoneOffice: string | null
  phoneMobile: string | null
  isInvoiceRecipient: boolean
}

export type ContactParseResult = { ok: true; data: ContactFields } | { ok: false; error: string }

type FormLike = { get(name: string): FormDataEntryValue | null }

const MAX = 200
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(form: FormLike, name: string): string {
  const v = form.get(name)
  return typeof v === 'string' ? v.trim().slice(0, MAX) : ''
}

/**
 * `storedEmail`: the contact's current email when editing. An unchanged stored value is accepted
 * as-is, so a migrated contact with an odd email can still have its other fields edited.
 */
export function parseContactForm(form: FormLike, storedEmail?: string | null): ContactParseResult {
  const firstName = text(form, 'firstName')
  const lastName = text(form, 'lastName')
  const email = text(form, 'email')
  if (!firstName && !lastName) return { ok: false, error: 'A contact needs a first or last name.' }
  if (email && email !== (storedEmail ?? '').trim() && !EMAIL_RE.test(email)) return { ok: false, error: 'That email address doesn’t look right.' }
  return {
    ok: true,
    data: {
      // firstName is required in the schema; keep the migrated-data convention of "—" when only a last name is given.
      firstName: firstName || '—',
      lastName,
      title: text(form, 'title') || null,
      email: email || null,
      phoneOffice: text(form, 'phoneOffice') || null,
      phoneMobile: text(form, 'phoneMobile') || null,
      isInvoiceRecipient: form.get('isInvoiceRecipient') === 'on',
    },
  }
}

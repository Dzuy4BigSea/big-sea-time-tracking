/** Pure helpers for composing client emails (recipients, template choice). Unit-tested. */
import { normalizeRecipients } from '@/modules/email/sendgrid'

export interface ContactLite {
  email: string | null
  isInvoiceRecipient: boolean
}

/**
 * Who receives client invoice mail (specs/15 "client invoice recipient(s)"): every contact flagged
 * as an invoice recipient that has an email, de-duplicated. When none is flagged, the first contact
 * with an email (Harvest's behaviour for a client with a single contact).
 */
export function invoiceRecipients(contacts: ContactLite[]): string[] {
  const flagged = normalizeRecipients(contacts.filter((c) => c.isInvoiceRecipient).map((c) => c.email))
  if (flagged.length) return flagged
  return normalizeRecipients(contacts.map((c) => c.email)).slice(0, 1)
}

/**
 * The reminder wording to use. The built-in default reminder text says "N days past due", which is
 * wrong for a reminder sent before (or on) the due date; in that case fall back to the template's
 * own not-yet-due wording. A customized template is always used as written.
 */
export function reminderMessage(
  stored: { subject: string; body: string },
  builtIn: { subject: string; body: string },
  late: boolean,
): { subject?: string; intro?: string } {
  if (late) return { subject: stored.subject, intro: stored.body }
  return {
    subject: stored.subject === builtIn.subject ? undefined : stored.subject,
    intro: stored.body === builtIn.body ? undefined : stored.body,
  }
}

/** Short summary for the activity log: "a@x.com" or "a@x.com and 2 others". */
export function recipientSummary(to: string[]): string {
  if (to.length <= 1) return to[0] ?? ''
  return `${to[0]} and ${to.length - 1} other${to.length === 2 ? '' : 's'}`
}

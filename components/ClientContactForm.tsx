'use client'

import { useEffect, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { saveContactAction, type ContactFormState } from '@/app/clients/actions'

const inp = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export interface ContactValues {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phoneOffice: string | null
  phoneMobile: string | null
  isInvoiceRecipient: boolean
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

/**
 * Add (no `contact`) or edit (with `contact`) a client's point of contact (BugHerd #3).
 * On success the add form clears, and an edit form inside a <details> closes it.
 */
export function ClientContactForm({ clientId, contact }: { clientId: string; contact?: ContactValues }) {
  const [state, formAction] = useFormState<ContactFormState, FormData>(saveContactAction, {})
  const ref = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!state.ok || !ref.current) return
    if (contact) ref.current.closest('details')?.removeAttribute('open')
    else ref.current.reset()
  }, [state.savedAt, state.ok, contact])

  const firstName = contact?.firstName === '—' ? '' : contact?.firstName

  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      <input name="firstName" placeholder="First name" defaultValue={firstName ?? ''} className={`${inp} w-32`} aria-label="First name" />
      <input name="lastName" placeholder="Last name" defaultValue={contact?.lastName ?? ''} className={`${inp} w-32`} aria-label="Last name" />
      <input name="title" placeholder="Title" defaultValue={contact?.title ?? ''} className={`${inp} w-36`} aria-label="Title" />
      <input name="email" type="email" placeholder="Email" defaultValue={contact?.email ?? ''} className={`${inp} w-52`} aria-label="Email" />
      <input name="phoneOffice" placeholder="Office phone" defaultValue={contact?.phoneOffice ?? ''} className={`${inp} w-36`} aria-label="Office phone" />
      <input name="phoneMobile" placeholder="Mobile phone" defaultValue={contact?.phoneMobile ?? ''} className={`${inp} w-36`} aria-label="Mobile phone" />
      <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
        <input type="checkbox" name="isInvoiceRecipient" defaultChecked={contact?.isInvoiceRecipient ?? false} /> Invoice recipient
      </label>
      <Submit label={contact ? 'Save contact' : 'Add contact'} />
      {state.error && <span className="w-full text-sm text-red-600">{state.error}</span>}
    </form>
  )
}

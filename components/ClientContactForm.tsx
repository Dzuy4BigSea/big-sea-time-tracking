'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
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
 * `variant="inline"` (default) is the compact row on the client page: on success the add form
 * clears, and an edit form inside a <details> closes it. `variant="page"` is Harvest's
 * label-left form for /clients/[id]/contacts/…; the action redirects back to /clients on save.
 */
export function ClientContactForm({
  clientId,
  contact,
  variant = 'inline',
}: {
  clientId: string
  contact?: ContactValues
  variant?: 'inline' | 'page'
}) {
  const [state, formAction] = useFormState<ContactFormState, FormData>(saveContactAction, {})
  const ref = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (variant !== 'inline' || !state.ok || !ref.current) return
    if (contact) ref.current.closest('details')?.removeAttribute('open')
    else ref.current.reset()
  }, [state.savedAt, state.ok, contact, variant])

  const firstName = contact?.firstName === '—' ? '' : contact?.firstName

  if (variant === 'page') {
    const row = 'grid grid-cols-1 items-center gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4'
    const label = 'text-sm font-medium text-gray-700'
    const field = `${inp} w-full max-w-sm`
    return (
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="returnTo" value="clients" />
        {contact && <input type="hidden" name="contactId" value={contact.id} />}
        <label className={row}>
          <span className={label}>First name</span>
          <input name="firstName" defaultValue={firstName ?? ''} className={field} autoFocus={!contact} />
        </label>
        <label className={row}>
          <span className={label}>Last name</span>
          <input name="lastName" defaultValue={contact?.lastName ?? ''} className={field} />
        </label>
        <label className={row}>
          <span className={label}>Email</span>
          <input name="email" type="email" defaultValue={contact?.email ?? ''} className={field} />
        </label>
        <label className={row}>
          <span className={label}>Invoice email default</span>
          <select name="isInvoiceRecipient" defaultValue={contact?.isInvoiceRecipient ? 'on' : ''} className={`${inp} w-full max-w-[12rem]`}>
            <option value="">None</option>
            <option value="on">Recipient</option>
          </select>
        </label>
        <label className={row}>
          <span className={label}>Title</span>
          <input name="title" defaultValue={contact?.title ?? ''} className={field} />
        </label>
        <label className={row}>
          <span className={label}>Office number</span>
          <input name="phoneOffice" type="tel" defaultValue={contact?.phoneOffice ?? ''} className={field} />
        </label>
        <label className={row}>
          <span className={label}>Mobile number</span>
          <input name="phoneMobile" type="tel" defaultValue={contact?.phoneMobile ?? ''} className={field} />
        </label>
        <div className="flex items-center gap-3 border-t border-gray-100 pt-4 sm:pl-[11rem]">
          <Submit label={contact ? 'Update contact' : 'Save contact'} />
          <Link href="/clients" className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </Link>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      </form>
    )
  }

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

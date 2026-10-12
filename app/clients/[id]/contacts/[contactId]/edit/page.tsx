import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ClientContactForm } from '@/components/ClientContactForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { deleteContactAction } from '@/app/clients/actions'
import { contactName } from '@/modules/clients/clientList'

export const dynamic = 'force-dynamic'

/** Harvest's edit contact page: "{Name} ({Client})" with Delete contact (specs/24 §3). */
export default async function EditContactPage({ params }: { params: { id: string; contactId: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    redirect('/clients')
  }
  const contact = await prisma.clientContact.findFirst({
    where: { id: params.contactId, clientId: params.id, accountId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      email: true,
      phoneOffice: true,
      phoneMobile: true,
      isInvoiceRecipient: true,
      client: { select: { id: true, name: true } },
    },
  })
  if (!contact) notFound()
  const { client, ...values } = contact
  const name = contactName(contact)

  return (
    <div className="max-w-2xl">
      <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Clients
      </Link>
      <div className="mb-5 mt-2 flex items-start gap-3">
        <h1 className="text-2xl font-semibold">
          {name} ({client.name})
        </h1>
        <form action={deleteContactAction} className="ml-auto">
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="contactId" value={contact.id} />
          <input type="hidden" name="returnTo" value="clients" />
          <ConfirmSubmit
            message={`Delete ${name} from ${client.name}?`}
            className="whitespace-nowrap rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Delete contact
          </ConfirmSubmit>
        </form>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <ClientContactForm clientId={client.id} contact={values} variant="page" />
      </div>
    </div>
  )
}

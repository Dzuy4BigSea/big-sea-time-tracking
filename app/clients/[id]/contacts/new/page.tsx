import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ClientContactForm } from '@/components/ClientContactForm'

export const dynamic = 'force-dynamic'

/** Harvest's "New contact for {Client}" page (specs/24 §3). */
export default async function NewContactPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    redirect('/clients')
  }
  const client = await prisma.client.findFirst({ where: { id: params.id, accountId }, select: { id: true, name: true } })
  if (!client) notFound()

  return (
    <div className="max-w-2xl">
      <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New contact for {client.name}</h1>
      <p className="mb-5 mt-2 text-sm text-gray-500">
        No email is sent when adding a contact. The email address is captured for your own reference and for the convenience
        of sending invoices to the client directly.
      </p>
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <ClientContactForm clientId={client.id} variant="page" />
      </div>
    </div>
  )
}

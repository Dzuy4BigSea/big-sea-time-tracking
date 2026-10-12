import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { listEntities } from '@/lib/entities'
import { NewClientForm } from '@/components/NewClientForm'

export const dynamic = 'force-dynamic'

export default async function NewClientPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    redirect('/clients')
  }
  const entities = await listEntities(accountId)

  return (
    <div className="max-w-2xl">
      <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Clients
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">New client</h1>
      <NewClientForm variant="page" entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />
    </div>
  )
}

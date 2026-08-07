import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EditPersonForm } from '@/components/EditPersonForm'
import { listEntities } from '@/lib/entities'

export const dynamic = 'force-dynamic'

export default async function EditPersonPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    redirect('/team')
  }

  const [person, entities] = await Promise.all([
    prisma.user.findFirst({
      where: { id: params.id, accountId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        permissionProfile: true,
        type: true,
        capacityHoursPerWeek: true,
        isActive: true,
        homeEntityId: true,
      },
    }),
    listEntities(accountId),
  ])
  if (!person) notFound()

  return (
    <div>
      <Link href="/team" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Team
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit person</h1>
      <EditPersonForm
        person={{
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          permissionProfile: person.permissionProfile,
          type: person.type,
          capacityHoursPerWeek: person.capacityHoursPerWeek ? Number(person.capacityHoursPerWeek) : null,
          isActive: person.isActive,
          homeEntityId: person.homeEntityId,
        }}
        entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))}
      />
    </div>
  )
}

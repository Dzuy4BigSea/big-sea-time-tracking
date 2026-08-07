import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EditTaskForm } from '@/components/EditTaskForm'

export const dynamic = 'force-dynamic'

export default async function EditTaskPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_tasks')) {
    redirect('/tasks')
  }

  const task = await prisma.task.findFirst({
    where: { id: params.id, accountId },
    select: { id: true, name: true, defaultBillable: true, defaultHourlyRateCents: true, autoAddToNewProjects: true },
  })
  if (!task) notFound()

  return (
    <div>
      <Link href="/tasks" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Tasks
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit task</h1>
      <EditTaskForm task={task} />
    </div>
  )
}

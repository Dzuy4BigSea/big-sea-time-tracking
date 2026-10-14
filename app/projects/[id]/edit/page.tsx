import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EditProjectForm } from '@/components/EditProjectForm'
import { ProjectTeamManager } from '@/components/ProjectTeamManager'
import { ProjectBillingProvider } from '@/components/ProjectBillingContext'
import { listEntities } from '@/lib/entities'
import { projectNotesHtml } from '@/modules/projects/notes'

export const dynamic = 'force-dynamic'

export default async function EditProjectPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')) {
    redirect(`/projects/${params.id}`)
  }

  const [project, entities] = await Promise.all([
    prisma.project.findFirst({
      where: { id: params.id, accountId },
      include: { client: { select: { name: true } } },
    }),
    listEntities(accountId),
  ])
  if (!project) notFound()

  return (
    <div>
      <Link href={`/projects/${project.id}`} className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to project
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit project</h1>
      {/* Shares the form's unsaved project type / rate method with the Team card's rate columns. */}
      <ProjectBillingProvider projectType={project.projectType} rateMethod={project.billableRateMethod}>
        <EditProjectForm
          project={{
            id: project.id,
            name: project.name,
            code: project.code,
            clientName: project.client.name,
            projectType: project.projectType,
            billableRateMethod: project.billableRateMethod,
            projectHourlyRateCents: project.projectHourlyRateCents,
            projectFeesCents: project.projectFeesCents,
            budgetMethod: project.budgetMethod,
            budgetValue: project.budgetValue,
            budgetResetsMonthly: project.budgetResetsMonthly,
            budgetAlertPercent: project.budgetAlertPercent,
            entityId: project.entityId,
            notesHtml: projectNotesHtml(project.notes),
          }}
          entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))}
        />
        <ProjectTeamManager
          accountId={accountId}
          project={{ id: project.id, projectType: project.projectType, billableRateMethod: project.billableRateMethod }}
        />
      </ProjectBillingProvider>
    </div>
  )
}

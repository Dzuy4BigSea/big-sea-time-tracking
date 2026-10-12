import { prisma } from '@/lib/prisma'
import { ymd } from '@/lib/week'
import { ProjectTeamTable, type TeamRow } from '@/components/ProjectTeamTable'
import { initialsOf, rateCell, ratesByUser } from '@/modules/projects/teamCard'

/**
 * Project team management (assign / remove people, "Manages this project", per-person rate) — lives
 * on the project Edit page (BugHerd #8); the project's Team tab is read-only time tracked.
 * Server component: callers must already have checked `manage_projects`; every action re-checks
 * permission and tenant scope server-side. Rates shown are derived (person default in force today,
 * or the per-project override), never typed in here except through setProjectUserRateAction.
 */
export async function ProjectTeamManager({
  accountId,
  project,
}: {
  accountId: string
  project: { id: string; projectType: string; billableRateMethod: string | null }
}) {
  const assignments = await prisma.projectUserAssignment.findMany({
    where: { accountId, projectId: project.id, isActive: true },
    include: { user: { select: { id: true, firstName: true, lastName: true, isActive: true, archivedAt: true } } },
    orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
  })
  const assignedIds = assignments.map((a) => a.userId)
  const rateSelect = { userId: true, hourlyRateCents: true, startDate: true, endDate: true } as const
  const [users, billableRates, costRates] = await Promise.all([
    prisma.user.findMany({
      where: { accountId, isActive: true, archivedAt: null, id: { notIn: assignedIds } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.personBillableRate.findMany({ where: { accountId, userId: { in: assignedIds } }, select: rateSelect }),
    prisma.personCostRate.findMany({ where: { accountId, userId: { in: assignedIds } }, select: rateSelect }),
  ])
  const billableBy = ratesByUser(billableRates)
  const costBy = ratesByUser(costRates)
  const today = new Date(`${ymd(new Date())}T00:00:00.000Z`)

  // Active people first, archived people (greyed) at the end — like Harvest.
  const rows: TeamRow[] = assignments
    .map((a) => ({
      userId: a.userId,
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      initials: initialsOf(a.user.firstName, a.user.lastName),
      archived: !a.user.isActive || a.user.archivedAt != null,
      isProjectManager: a.isProjectManager,
      billable: rateCell(a.hourlyRateCents, billableBy.get(a.userId), today),
      cost: rateCell(null, costBy.get(a.userId), today),
    }))
    .sort((x, y) => Number(x.archived) - Number(y.archived))

  return (
    <section id="team" className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Team</h2>
      <p className="mb-3 text-sm text-gray-500">People assigned to this project can track time to it. Changes here save immediately.</p>
      <ProjectTeamTable
        projectId={project.id}
        savedProjectType={project.projectType}
        savedRateMethod={project.billableRateMethod}
        rows={rows}
        addable={users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }))}
      />
    </section>
  )
}

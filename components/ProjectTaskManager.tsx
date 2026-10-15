import { prisma } from '@/lib/prisma'
import { ProjectTasksTable, type TaskRow, type Teammate } from '@/components/ProjectTasksTable'
import { initialsOf } from '@/modules/projects/teamCard'
import { addableTaskOptions } from '@/modules/projects/taskPicker'

/**
 * Harvest-style Tasks card for the Edit project page: the project's tasks, who can track time to
 * them (every active teammate, the default), billable flags and add/remove. Server component:
 * callers must already have checked `manage_projects`; every action re-checks permission and
 * tenant scope server-side.
 */
export async function ProjectTaskManager({ accountId, projectId }: { accountId: string; projectId: string }) {
  const [assignments, team, tasks] = await Promise.all([
    prisma.projectTaskAssignment.findMany({
      where: { accountId, projectId, isActive: true },
      select: { taskId: true, billable: true, hourlyRateCents: true, task: { select: { name: true } } },
      orderBy: { task: { name: 'asc' } },
    }),
    prisma.projectUserAssignment.findMany({
      where: { accountId, projectId, isActive: true, user: { isActive: true, archivedAt: null } },
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
    }),
    // Every active task (the /tasks "Active tasks" list); sorted in addableTaskOptions.
    prisma.task.findMany({ where: { accountId, archivedAt: null }, select: { id: true, name: true, archivedAt: true } }),
  ])
  const assigned = new Set(assignments.map((a) => a.taskId))
  const rows: TaskRow[] = assignments.map((a) => ({
    taskId: a.taskId,
    name: a.task.name,
    billable: a.billable,
    rateCents: a.hourlyRateCents,
  }))
  const teammates: Teammate[] = team.map(({ user: u }) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    initials: initialsOf(u.firstName, u.lastName),
  }))

  return (
    <section id="tasks" className="mt-8">
      <ProjectTasksTable
        projectId={projectId}
        rows={rows}
        teammates={teammates}
        addable={addableTaskOptions(tasks, assigned)}
      />
    </section>
  )
}

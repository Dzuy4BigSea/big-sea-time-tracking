import { prisma } from '@/lib/prisma'

export interface TopBarProject {
  id: string
  name: string
  tasks: { id: string; name: string }[]
}

export interface TopBarRunning {
  id: string
  projectLabel: string
  taskName: string
  startedAtISO: string
  baseMinutes: number
}

export interface TopBarData {
  projects: TopBarProject[]
  running: TopBarRunning | null
}

/**
 * Data for the global top bar (Timer / Track time / Create invoice / More).
 * Mirrors the timesheet page's project+timer queries, scoped to the signed-in user.
 */
export async function getTopBarData(userId: string): Promise<TopBarData> {
  const [assignments, running] = await Promise.all([
    prisma.projectUserAssignment.findMany({
      where: { userId, isActive: true },
      select: {
        project: {
          select: {
            id: true,
            name: true,
            code: true,
            taskAssignments: {
              where: { isActive: true },
              select: { task: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { project: { name: 'asc' } },
    }),
    prisma.timeEntry.findFirst({
      where: { userId, isRunning: true },
      select: {
        id: true,
        minutes: true,
        timerStartedAt: true,
        project: { select: { name: true, code: true } },
        task: { select: { name: true } },
      },
    }),
  ])

  const projects: TopBarProject[] = assignments.map((a) => ({
    id: a.project.id,
    name: a.project.code ? `[${a.project.code}] ${a.project.name}` : a.project.name,
    tasks: a.project.taskAssignments.map((ta) => ta.task),
  }))

  const runningData: TopBarRunning | null =
    running && running.timerStartedAt
      ? {
          id: running.id,
          projectLabel: running.project.code ? `[${running.project.code}] ${running.project.name}` : running.project.name,
          taskName: running.task.name,
          startedAtISO: running.timerStartedAt.toISOString(),
          baseMinutes: running.minutes,
        }
      : null

  return { projects, running: runningData }
}

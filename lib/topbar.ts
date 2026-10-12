import { prisma } from '@/lib/prisma'
import { loggableProjectsFor } from '@/lib/timesheetSubject'

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
 * Mirrors the timesheet page's project+timer queries, scoped to the signed-in user. Only active
 * projects (and active clients) are offered — archived ones can't take new time.
 */
export async function getTopBarData(userId: string): Promise<TopBarData> {
  const [loggable, running] = await Promise.all([
    loggableProjectsFor(userId),
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

  const projects: TopBarProject[] = loggable.map((p) => ({
    id: p.id,
    name: p.code ? `[${p.code}] ${p.name}` : p.name,
    tasks: p.tasks,
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

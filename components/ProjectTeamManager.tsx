import { prisma } from '@/lib/prisma'
import {
  assignUserToProjectAction,
  toggleProjectManagerAction,
  unassignUserFromProjectAction,
  setProjectUserRateAction,
} from '@/app/projects/actions'

/**
 * Project team management (assign / remove people, PM flag, per-person rate) — lives on the
 * project Edit page (BugHerd #8); the project's Team tab is read-only time tracked.
 * Server component: callers must already have checked `manage_projects`; every action
 * re-checks permission and tenant scope server-side.
 */
export async function ProjectTeamManager({
  accountId,
  project,
}: {
  accountId: string
  project: { id: string; billableRateMethod: string | null }
}) {
  const dollars = (c: number | null) => (c ? (c / 100).toFixed(2) : '')
  const perPersonRates = project.billableRateMethod === 'person'
  const [assignments, users] = await Promise.all([
    prisma.projectUserAssignment.findMany({
      where: { accountId, projectId: project.id, isActive: true },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { user: { firstName: 'asc' } },
    }),
    prisma.user.findMany({
      where: { accountId, isActive: true, archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }],
    }),
  ])
  const assignedIds = new Set(assignments.map((a) => a.userId))
  const addableUsers = users.filter((u) => !assignedIds.has(u.id))

  return (
    <section id="team" className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Team</h2>
      <p className="mb-3 text-sm text-gray-500">People assigned to this project can track time to it.</p>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100 text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 font-medium text-gray-800">
                {a.user.firstName} {a.user.lastName}
                {a.isProjectManager && <span className="ml-2 rounded-full bg-brand-teal-50 px-2 py-0.5 text-xs font-medium text-brand-teal">PM</span>}
              </span>
              {perPersonRates && (
                <form action={setProjectUserRateAction} className="flex items-center gap-1">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="userId" value={a.user.id} />
                  <span className="text-xs text-gray-400">$</span>
                  <input name="rate" defaultValue={dollars(a.hourlyRateCents)} placeholder="rate/h" className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <button className="text-xs text-brand-teal hover:underline">save</button>
                </form>
              )}
              <form action={toggleProjectManagerAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="userId" value={a.user.id} />
                <button className="text-xs text-gray-500 hover:text-brand-teal">{a.isProjectManager ? 'Remove PM' : 'Make PM'}</button>
              </form>
              <form action={unassignUserFromProjectAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="userId" value={a.user.id} />
                <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
              </form>
            </li>
          ))}
          {assignments.length === 0 && <li className="px-4 py-3 text-gray-400">No one assigned yet.</li>}
        </ul>
        {addableUsers.length > 0 && (
          <form action={assignUserToProjectAction} className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
            <input type="hidden" name="projectId" value={project.id} />
            <select name="userId" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {addableUsers.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-600"><input type="checkbox" name="isProjectManager" /> Project manager</label>
            <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add to project</button>
          </form>
        )}
      </div>
    </section>
  )
}

import { prisma } from '@/lib/prisma'
import {
  asanaJson, asanaPreflight, asanaTaskFor, baseValues, externalRefFor, formState, handleAsanaCall, personForAsanaUser, runningTimerFor, taskOptions,
} from '@/lib/asanaApp'
import { buildForm, hasTrackFields, readValues, toCommand } from '@/modules/integrations/asanaApp/form'
import { taskResourceUrl } from '@/modules/integrations/asanaApp/widget'
import { checkLoggable, logTime } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/**
 * Asana: the form was submitted (specs/29, AC-ASANAAPP-005–008). The stop-only form stops the person's
 * timer; otherwise a blank Duration starts a timer and a duration saves an entry, linked to the Asana
 * task. Success answers the resource Asana attaches to the task (the Track2 card).
 */
export async function POST(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    if (!me) return asanaJson(buildForm(await formState(ctx, null, null)), 400)
    const taskGid = ctx.call.task
    if (!taskGid) return asanaJson({ error: 'Open Track time from an Asana task.' }, 400)
    const done = () => asanaJson({ resource_name: 'Track2 time', resource_url: taskResourceUrl(ctx.appUrl, taskGid) })

    const raw = ctx.call.values
    const values = readValues(raw, await baseValues(me, ctx.now))
    if (!hasTrackFields(raw)) {
      // The stop-only form (AC-ASANAAPP-007).
      const running = await runningTimerFor(me, taskGid, ctx.now)
      if (running?.onThisTask && (await stopTimer(prisma, { userId: me.userId, now: ctx.now }))) return done()
      return asanaJson(buildForm(await formState(ctx, me, values, { formError: 'Your timer had already stopped. Track time again if you need to.' })), 400)
    }

    const tasks = await taskOptions(me, values.projectId)
    const again = async (extra: Parameters<typeof formState>[3]) => asanaJson(buildForm(await formState(ctx, me, values, { tasks, ...extra })), 400)
    const checked = toCommand(values, { tasks })
    if (!checked.ok) return again({ errors: checked.errors })
    const cmd = checked.command

    const refused = await checkLoggable(prisma, { accountId: me.accountId, userId: me.userId, projectId: cmd.projectId, taskId: cmd.taskId })
    if (refused) return again({ formError: refused })
    const task = await asanaTaskFor(ctx)
    const external = externalRefFor(task ?? { gid: taskGid, name: '', projectGids: [], permalink: null })
    const spentDate = new Date(`${cmd.date}T00:00:00.000Z`)
    if (cmd.kind === 'start') {
      await startTimer(prisma, { userId: me.userId, projectId: cmd.projectId, taskId: cmd.taskId, now: ctx.now, spentDate, notes: cmd.notes || null, external })
    } else {
      await logTime(prisma, { userId: me.userId, projectId: cmd.projectId, taskId: cmd.taskId, spentDate, minutes: cmd.minutes, notes: cmd.notes || undefined, external })
    }
    return done()
  })
}

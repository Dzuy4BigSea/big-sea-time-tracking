import { prisma } from '@/lib/prisma'
import { getAccountClock } from '@/lib/accountClock'
import {
  asanaJson, asanaPreflight, asanaTaskFor, baseValues, externalRefFor, formState, handleAsanaCall, personForAsanaUser, runningTimerFor, taskOptions,
} from '@/lib/asanaApp'
import { buildForm, readValues, toCommand } from '@/modules/integrations/asanaApp/form'
import { taskResourceUrl } from '@/modules/integrations/asanaApp/widget'
import { checkLoggable, logTime } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/**
 * Asana: the form was submitted → start a timer, log hours or stop the timer, linked to the Asana task
 * (specs/29, AC-ASANAAPP-005–008). Success answers the resource Asana attaches to the task (the widget).
 */
export async function POST(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    if (!me) return asanaJson(buildForm(await formState(ctx, null, null)), 400)
    const taskGid = ctx.call.task
    if (!taskGid) return asanaJson({ error: 'Open Track time from an Asana task.' }, 400)

    const values = readValues(ctx.call.values, await baseValues(me, ctx.now))
    const [tasks, running] = await Promise.all([taskOptions(me, values.projectId), runningTimerFor(me, taskGid, ctx.now)])
    const again = async (extra: Parameters<typeof formState>[3]) => asanaJson(buildForm(await formState(ctx, me, values, { tasks, ...extra })), 400)

    const checked = toCommand(values, { tasks, hasRunningTimer: !!running })
    if (!checked.ok) return again({ errors: checked.errors })
    const cmd = checked.command

    if (cmd.kind === 'stop') {
      const stopped = await stopTimer(prisma, { userId: me.userId, now: ctx.now })
      if (!stopped) return again({ errors: { what: 'No timer is running.' } })
    } else {
      const refused = await checkLoggable(prisma, { accountId: me.accountId, userId: me.userId, projectId: cmd.projectId, taskId: cmd.taskId })
      if (refused) return again({ formError: refused })
      const task = await asanaTaskFor(ctx)
      const external = externalRefFor(task ?? { gid: taskGid, name: '', projectGids: [], permalink: null })
      if (cmd.kind === 'start') {
        const clock = await getAccountClock(me.accountId)
        await startTimer(prisma, { userId: me.userId, projectId: cmd.projectId, taskId: cmd.taskId, now: ctx.now, timezone: clock.timezone, notes: cmd.notes || null, external })
      } else {
        await logTime(prisma, {
          userId: me.userId,
          projectId: cmd.projectId,
          taskId: cmd.taskId,
          spentDate: new Date(`${cmd.date}T00:00:00.000Z`),
          minutes: cmd.minutes,
          notes: cmd.notes || undefined,
          external,
        })
      }
    }
    return asanaJson({ resource_name: 'Track2 time', resource_url: taskResourceUrl(ctx.appUrl, taskGid) })
  })
}

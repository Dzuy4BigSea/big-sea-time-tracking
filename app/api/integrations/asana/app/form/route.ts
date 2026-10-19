import { asanaJson, asanaPreflight, asanaTaskFor, formState, handleAsanaCall, initialValues, personForAsanaUser, runningTimerFor } from '@/lib/asanaApp'
import { buildForm } from '@/modules/integrations/asanaApp/form'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/** Asana: "Track time" was clicked on a task → the form (specs/29, AC-ASANAAPP-003/004). */
export async function GET(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    if (!me) return asanaJson(buildForm(await formState(ctx, null, null)))
    const [task, running] = await Promise.all([asanaTaskFor(ctx), runningTimerFor(me, ctx.call.task, ctx.now)])
    const values = await initialValues(me, task, running, ctx.now)
    return asanaJson(buildForm(await formState(ctx, me, values)))
  })
}

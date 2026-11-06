import { asanaJson, asanaPreflight, baseValues, formState, handleAsanaCall, personForAsanaUser, taskOptions } from '@/lib/asanaApp'
import { afterChange, buildForm, readValues } from '@/modules/integrations/asanaApp/form'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/** Asana: a watched field changed (What / Project / Task) → the whole form again (specs/29). */
export async function POST(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    if (!me) return asanaJson(buildForm(await formState(ctx, null, null)))
    const read = readValues(ctx.call.values, await baseValues(me, ctx.now))
    const tasks = await taskOptions(me, read.projectId)
    const values = afterChange(read, ctx.call.changedField, tasks)
    return asanaJson(buildForm(await formState(ctx, me, values, { tasks })))
  })
}

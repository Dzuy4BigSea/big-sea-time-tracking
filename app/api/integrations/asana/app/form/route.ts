import { asanaJson, asanaPreflight, asanaTaskFor, formState, handleAsanaCall, initialValues, personForAsanaUser } from '@/lib/asanaApp'
import { buildForm } from '@/modules/integrations/asanaApp/form'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/** Asana: "Track time" was clicked on a task → the form, or the stop-only form when their timer runs on this task (specs/29, AC-ASANAAPP-003/004/007). */
export async function GET(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    if (!me) return asanaJson(buildForm(await formState(ctx, null, null)))
    const values = await initialValues(me, await asanaTaskFor(ctx), ctx.now)
    return asanaJson(buildForm(await formState(ctx, me, values)))
  })
}

import { asanaJson, asanaPreflight, handleAsanaCall, personForAsanaUser, projectItems } from '@/lib/asanaApp'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/** Asana: typeahead on the form's Project field → the person's loggable projects (specs/29). */
export async function GET(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const me = await personForAsanaUser(ctx)
    return asanaJson({ header: 'Your projects', items: me ? await projectItems(me, ctx.call.query) : [] })
  })
}

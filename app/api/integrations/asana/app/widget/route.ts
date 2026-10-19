import { asanaJson, asanaPreflight, handleAsanaCall, personForAsanaUser, widgetNumbers } from '@/lib/asanaApp'
import { buildWidget, taskGidFromResourceUrl } from '@/modules/integrations/asanaApp/widget'

export const dynamic = 'force-dynamic'
export const OPTIONS = asanaPreflight

/** Asana: a task with a Track2 attachment was opened → the Track2 card (specs/29, AC-ASANAAPP-009). */
export async function GET(req: Request) {
  return handleAsanaCall(req, async (ctx) => {
    const taskGid = taskGidFromResourceUrl(ctx.appUrl, ctx.call.resourceUrl) ?? ctx.call.task
    if (!taskGid) return asanaJson({ error: 'Unknown task.' }, 404)
    const me = await personForAsanaUser(ctx)
    if (!me) {
      return asanaJson({
        template: 'summary_with_details_v0',
        metadata: {
          title: 'Link your Track2 account to see time here',
          fields: [{ type: 'pill', name: 'Track2', text: 'Not linked', color: 'cool-gray' }],
          footer: { footer_type: 'custom_text', text: 'Use Track time on this task to link' },
        },
      })
    }
    return asanaJson(buildWidget({ ...(await widgetNumbers(me, taskGid, ctx.now)), now: ctx.now }))
  })
}

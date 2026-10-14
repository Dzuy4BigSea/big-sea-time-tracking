'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, userCan } from '@/lib/session'
import { runAccountHealth } from '@/modules/observability/healthRunner'

export interface RunChecksState {
  ok?: boolean
  error?: string
  ranAt?: string
  results?: Array<{ provider: string; check: string; entity: string | null; level: string; message: string }>
}

/**
 * "Run checks now" (Settings → Activity log): the same billing-chain checks the daily cron runs,
 * for the signed-in account only. Recorded as InvoiceEvents with source "app". No alert email:
 * the admin is looking at the results.
 */
export async function runChecksNowAction(_prev: RunChecksState, _form: FormData): Promise<RunChecksState> {
  const me = await requireUser()
  if (!userCan(me, 'edit_account_settings')) return { error: 'Only account admins can run the checks.' }
  try {
    const h = await runAccountHealth(me.accountId, { source: 'app', alert: false })
    revalidatePath('/settings/activity-log')
    return {
      ok: h.results.every((r) => r.level !== 'error'),
      ranAt: new Date().toISOString(),
      results: h.results.map((r) => ({ provider: r.provider, check: r.check, entity: r.entity, level: r.level, message: r.message })),
    }
  } catch (e) {
    return { error: `Checks failed to run: ${(e as Error)?.message?.slice(0, 200) ?? 'unknown error'}` }
  }
}

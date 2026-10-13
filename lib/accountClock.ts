import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TIMEZONE } from '@/lib/tz'

export interface AccountClock {
  /** IANA zone the account's "today" is computed in (Account.timezone). */
  timezone: string
  weekStartsOn: 'monday' | 'sunday'
}

/**
 * The account's timezone + week start, fetched once per request (React cache dedupes the layout,
 * the page and any server action in the same render). Use with lib/tz todayIn / todayYmdIn.
 */
export const getAccountClock = cache(async (accountId: string): Promise<AccountClock> => {
  const a = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true, weekStartsOn: true } })
  return {
    timezone: a?.timezone || DEFAULT_TIMEZONE,
    weekStartsOn: (a?.weekStartsOn ?? 'monday') as 'monday' | 'sunday',
  }
})

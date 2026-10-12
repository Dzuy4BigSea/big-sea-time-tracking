import { prisma } from '@/lib/prisma'

/** The account's week-start preference (Settings → Preferences), defaulting to Monday. */
export async function accountWeekStartsOn(accountId: string): Promise<'monday' | 'sunday'> {
  const a = await prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } })
  return a?.weekStartsOn === 'sunday' ? 'sunday' : 'monday'
}

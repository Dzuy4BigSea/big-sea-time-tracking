import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { revokeMachineAccess } from '@/lib/revokeMachineAccess'
import { mintToken } from '@/modules/apiTokens/token'

// Deactivating/archiving someone must revoke their personal access tokens and connected-app grants, so
// reactivating them later doesn't silently revive old MCP/API credentials (security review L4).
describe('revokeMachineAccess', () => {
  const created: string[] = []
  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { id: { in: created } } })
    await prisma.$disconnect()
  })

  it('revokes only that person’s active tokens', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { accountId: 'acc_demo', email: 'frank@bigsea.demo' } })
    const other = await prisma.user.findFirstOrThrow({ where: { accountId: 'acc_demo', email: 'carol@bigsea.demo' } })
    const mk = async (userId: string) => {
      const t = mintToken()
      const row = await prisma.apiToken.create({ data: { accountId: 'acc_demo', userId, name: 'it', tokenHash: t.tokenHash, prefix: t.prefix } })
      created.push(row.id)
      return row.id
    }
    const mine = await mk(user.id)
    const theirs = await mk(other.id)

    await revokeMachineAccess('acc_demo', user.id)

    const [a, b] = await Promise.all([
      prisma.apiToken.findUniqueOrThrow({ where: { id: mine } }),
      prisma.apiToken.findUniqueOrThrow({ where: { id: theirs } }),
    ])
    expect(a.revokedAt).not.toBeNull()
    expect(b.revokedAt).toBeNull()
  })
})

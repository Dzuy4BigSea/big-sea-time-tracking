#!/usr/bin/env node
/**
 * Seed business entities (specs/16) and backfill existing records. Idempotent — safe to re-run.
 *
 * For every account: ensure exactly one default entity (fallback for all routing).
 * For the Big Sea account (the one with the connected Harvest integration, or name "Big Sea"):
 * also ensure a "Cordelia Labs" (CL) entity.
 * Then backfill: any Client/Project/Invoice with null entityId → the account's default entity;
 * any User with null homeEntityId → the account's default entity.
 *
 * Requires: DATABASE_URL (Supabase session pooler :5432).
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

function codeFromName(name) {
  const words = String(name || 'Company').trim().split(/\s+/)
  const code = (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
  return code || 'BS'
}

const accounts = await p.account.findMany({ select: { id: true, name: true } })
const harvestConn = await p.integrationConnection.findFirst({ where: { provider: 'harvest' }, select: { accountId: true } })
const bigSeaAccountId = harvestConn?.accountId ?? accounts.find((a) => /big\s*sea/i.test(a.name))?.id ?? null

for (const acc of accounts) {
  const isBigSea = acc.id === bigSeaAccountId
  // Ensure a default entity.
  let def = await p.businessEntity.findFirst({ where: { accountId: acc.id, isDefault: true } })
  if (!def) {
    const name = isBigSea ? 'Big Sea' : acc.name
    def = await p.businessEntity.create({
      data: { accountId: acc.id, name, code: isBigSea ? 'BS' : codeFromName(acc.name), isDefault: true, sortOrder: 0 },
    })
    console.log(`created default entity "${name}" for account ${acc.id}`)
  }
  // Ensure Cordelia Labs for the Big Sea account.
  if (isBigSea) {
    const cl = await p.businessEntity.findFirst({ where: { accountId: acc.id, code: 'CL' } })
    if (!cl) {
      await p.businessEntity.create({
        data: { accountId: acc.id, name: 'Cordelia Labs', code: 'CL', isDefault: false, sortOrder: 1 },
      })
      console.log(`created "Cordelia Labs" (CL) for account ${acc.id}`)
    }
  }
  // Backfill null entity references to the default entity.
  const [c, pr, inv, u] = await Promise.all([
    p.client.updateMany({ where: { accountId: acc.id, entityId: null }, data: { entityId: def.id } }),
    p.project.updateMany({ where: { accountId: acc.id, entityId: null }, data: { entityId: def.id } }),
    p.invoice.updateMany({ where: { accountId: acc.id, entityId: null }, data: { entityId: def.id } }),
    p.user.updateMany({ where: { accountId: acc.id, homeEntityId: null }, data: { homeEntityId: def.id } }),
  ])
  console.log(`account ${acc.id}: backfilled clients=${c.count} projects=${pr.count} invoices=${inv.count} users=${u.count}`)
}

await p.$disconnect()
console.log('done')

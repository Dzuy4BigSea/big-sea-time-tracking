#!/usr/bin/env node
/**
 * Repair Account.invoiceNumberSeq / estimateNumberSeq (INV-6) after the importer's alphabetical-max bug.
 *
 * `Invoice.number` is a String column, so the importer's old `_max: { number }` picked '999' over
 * '7801' and could leave the sequence BELOW the highest real invoice number. The next "Send" would then
 * try to reuse a number (and fail on the unique index, or worse, look like a duplicate to a client).
 * This sets each sequence to max(current, numeric max of trailing digits). It never lowers a sequence.
 *
 * Usage (DRY RUN by default):
 *   ACCOUNT_ID=acc_demo node --env-file=.env scripts/fix-number-sequences.mjs
 *   ACCOUNT_ID=acc_demo node --env-file=.env scripts/fix-number-sequences.mjs --confirm
 */
import { PrismaClient } from '@prisma/client'
import { has, requireAccountId } from './lib/guards.mjs'

const CONFIRM = has('--confirm')
const p = new PrismaClient()
const account = await requireAccountId(p)
const accountId = account.id

const numericMax = async (table) => {
  const [r] = await p.$queryRawUnsafe(
    `SELECT MAX((substring("number" from '([0-9]+)[[:space:]]*$'))::bigint) AS max,
            COUNT(*) FILTER (WHERE "number" IS NOT NULL)::int AS numbered
       FROM "${table}" WHERE "accountId" = $1 AND "number" ~ '[0-9]+[[:space:]]*$'`,
    accountId,
  )
  const alpha = await p.$queryRawUnsafe(`SELECT MAX("number") AS max FROM "${table}" WHERE "accountId" = $1`, accountId)
  // Top numbers, so an outlier (e.g. Harvest's 387523-style ids) is visible before applying.
  const top = await p.$queryRawUnsafe(
    `SELECT "number" FROM "${table}" WHERE "accountId" = $1 AND "number" ~ '[0-9]+[[:space:]]*$'
      ORDER BY (substring("number" from '([0-9]+)[[:space:]]*$'))::bigint DESC LIMIT 5`,
    accountId,
  )
  return { numeric: r?.max == null ? null : Number(r.max), numbered: r?.numbered ?? 0, alphabetical: alpha[0]?.max ?? null, top: top.map((t) => t.number) }
}

const acct = await p.account.findUnique({ where: { id: accountId }, select: { invoiceNumberSeq: true, estimateNumberSeq: true } })
const inv = await numericMax('Invoice')
const est = await numericMax('Estimate')
const INT_MAX = 2_147_483_647
const target = (cur, n) => (n != null && n <= INT_MAX ? Math.max(cur, n) : cur)
const nextInv = target(acct.invoiceNumberSeq, inv.numeric)
const nextEst = target(acct.estimateNumberSeq, est.numeric)

console.log(`\nAccount: ${account.name} (${accountId})   mode: ${CONFIRM ? 'CONFIRM (writes)' : 'DRY RUN'}`)
console.log(`  invoices : seq=${acct.invoiceNumberSeq}  numeric max=${inv.numeric ?? '—'}  (alphabetical max='${inv.alphabetical ?? '—'}')  → ${nextInv}${nextInv !== acct.invoiceNumberSeq ? '  CHANGE' : '  ok'}`)
console.log(`  estimates: seq=${acct.estimateNumberSeq}  numeric max=${est.numeric ?? '—'}  (alphabetical max='${est.alphabetical ?? '—'}')  → ${nextEst}${nextEst !== acct.estimateNumberSeq ? '  CHANGE' : '  ok'}`)
console.log(`  top invoice numbers: ${inv.top.join(', ') || '—'}   top estimate numbers: ${est.top.join(', ') || '—'}`)
if (inv.numeric != null && inv.numeric > INT_MAX) console.log('  ⚠️  an invoice number exceeds the Int range; left the invoice sequence alone, inspect manually.')

if (nextInv === acct.invoiceNumberSeq && nextEst === acct.estimateNumberSeq) {
  console.log('\nNothing to fix.')
} else if (!CONFIRM) {
  console.log('\n(dry run — nothing written. Re-run with --confirm to apply.)')
} else {
  // Guarded update: only ever raises the sequence, even if a send happened since we read it.
  await p.$executeRawUnsafe(
    `UPDATE "Account" SET "invoiceNumberSeq" = GREATEST("invoiceNumberSeq", $2), "estimateNumberSeq" = GREATEST("estimateNumberSeq", $3), "updatedAt" = now() WHERE id = $1`,
    accountId, nextInv, nextEst,
  )
  const after = await p.account.findUnique({ where: { id: accountId }, select: { invoiceNumberSeq: true, estimateNumberSeq: true } })
  console.log(`\n✅ Updated: invoiceNumberSeq=${after.invoiceNumberSeq} estimateNumberSeq=${after.estimateNumberSeq}`)
}
await p.$disconnect()

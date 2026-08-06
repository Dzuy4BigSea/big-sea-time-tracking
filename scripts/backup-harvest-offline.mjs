#!/usr/bin/env node
/**
 * Offline Harvest backup runner (spec 13). Completes a raw backup snapshot from a machine with NO
 * serverless time cap — required for the INITIAL full history because single year-chunks of a large
 * account (Big Sea: 25k–52k time entries/year, 100–300s each to pull) exceed any serverless request.
 * See MIGRATION-RUNBOOK.md. Incremental/delta pulls are small and run fine from the in-app button.
 *
 * Idempotent: reuses the newest `running` snapshot (or the one named by SNAPSHOT_ID) and skips every
 * part already captured, so it is safe to re-run after an interruption. It NEVER pulls twice.
 *
 * Requires env:
 *   DATABASE_URL           Supabase session pooler (:5432) — long-lived connection for a long run.
 *   INTEGRATION_ENC_KEY    same value as Vercel — used to decrypt the stored Harvest PAT.
 * Optional env:
 *   SNAPSHOT_ID            target a specific snapshot instead of the newest running one.
 *   ACCOUNT_ID             Track2 account id (defaults to the connection's account).
 *
 * Run:  node scripts/backup-harvest-offline.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createDecipheriv, createHash } from 'node:crypto'

const ENC_KEY = process.env.INTEGRATION_ENC_KEY
if (!ENC_KEY || ENC_KEY.length < 16) {
  console.error('Set INTEGRATION_ENC_KEY (same value as Vercel) before running.')
  process.exit(1)
}

const HARVEST_API = 'https://api.harvestapp.com/v2'
const PER_PAGE = 2000
const LIGHT = ['clients', 'contacts', 'projects', 'tasks', 'users', 'roles', 'expense_categories', 'estimates']
const HEAVY = ['time_entries', 'expenses', 'invoices']
const START_YEAR = 2008

const p = new PrismaClient()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function decrypt(payload) {
  const [v, ivB64, tagB64, dataB64] = payload.split(':')
  if (v !== 'v1') throw new Error('bad ciphertext')
  const key = createHash('sha256').update(ENC_KEY).digest()
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  d.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8')
}

async function hget(token, acct, path) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(`${HARVEST_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Harvest-Account-Id': acct, 'User-Agent': 'Track2 Migration (admin)', Accept: 'application/json' },
    })
    if (res.ok) return res.json()
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(15000, 1000 * 2 ** a))
      continue
    }
    throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 160)}`)
  }
  throw new Error(`GET ${path} exhausted retries`)
}

async function pullAll(token, acct, resource, { from, to } = {}) {
  const out = []
  let page = 1
  const q = [`per_page=${PER_PAGE}`]
  if (from) q.push(`from=${from}`)
  if (to) q.push(`to=${to}`)
  const base = q.join('&')
  for (let i = 0; i < 1000; i++) {
    const json = await hget(token, acct, `/${resource}?${base}&page=${page}`)
    out.push(...((json[resource]) ?? []))
    if (!json.next_page) break
    page = json.next_page
  }
  return out
}

function workList() {
  const items = []
  for (const r of LIGHT) items.push({ resource: r, chunk: null })
  const end = new Date().getUTCFullYear()
  for (const r of HEAVY) for (let y = START_YEAR; y <= end; y++) items.push({ resource: r, chunk: String(y), from: `${y}-01-01`, to: `${y}-12-31` })
  return items
}
const wk = (w) => `${w.resource}|${w.chunk ?? ''}`

const conn = await p.integrationConnection.findFirst({ where: { provider: 'harvest', status: 'connected' } })
if (!conn) { console.error('No connected Harvest integration found.'); await p.$disconnect(); process.exit(1) }
const token = decrypt(conn.secretsEnc.accessToken)
const acct = String(conn.config.harvestAccountId)
const accountId = process.env.ACCOUNT_ID || conn.accountId
let snap = process.env.SNAPSHOT_ID
  ? await p.migrationSnapshot.findFirst({ where: { id: process.env.SNAPSHOT_ID, accountId } })
  : await p.migrationSnapshot.findFirst({ where: { accountId, status: 'running' }, orderBy: { createdAt: 'desc' } })
if (!snap) {
  snap = await p.migrationSnapshot.create({
    data: { accountId, source: 'harvest', status: 'running', mode: 'full', meta: { startedAt: new Date().toISOString(), errors: {} }, createdByUserId: conn.connectedByUserId },
  })
  console.log('created new snapshot', snap.id)
}
console.log('snapshot', snap.id, 'account', accountId, 'harvest acct', acct)

const existing = await p.migrationSnapshotPart.findMany({ where: { snapshotId: snap.id }, select: { resource: true, chunk: true } })
const done = new Set(existing.map(wk))
const work = workList()
const errors = {}
let n = 0
for (const item of work) {
  if (done.has(wk(item))) continue
  n++
  try {
    const t0 = Date.now()
    const rows = await pullAll(token, acct, item.resource, item)
    const json = JSON.stringify(rows)
    const checksum = createHash('sha256').update(json).digest('hex')
    await p.migrationSnapshotPart.create({
      data: { snapshotId: snap.id, accountId, resource: item.resource, chunk: item.chunk, rowCount: rows.length, checksum, data: rows },
    })
    done.add(wk(item))
    console.log(`ok  ${wk(item)}  rows=${rows.length}  ${Date.now() - t0}ms`)
  } catch (e) {
    errors[wk(item)] = String(e.message).slice(0, 200)
    done.add(wk(item))
    console.log(`ERR ${wk(item)}  ${e.message}`)
  }
}

const remaining = work.filter((w) => !done.has(wk(w))).length
const errorKeys = Object.keys(errors)
const status = remaining === 0 ? (errorKeys.length ? 'partial' : 'complete') : 'running'
const grouped = await p.migrationSnapshotPart.groupBy({ by: ['resource'], where: { snapshotId: snap.id }, _sum: { rowCount: true } })
const counts = {}
for (const g of grouped) counts[g.resource] = g._sum.rowCount ?? 0

await p.migrationSnapshot.update({
  where: { id: snap.id },
  data: { status, entityCounts: counts, meta: { startedAt: new Date().toISOString(), errors, remaining, total: work.length, completedVia: 'offline-runner' }, errorMessage: errorKeys.length ? `Issues: ${errorKeys.join(', ')}` : null },
})
if (status === 'complete' || status === 'partial') {
  await p.integrationConnection.update({ where: { id: conn.id }, data: { config: { harvestAccountId: acct, lastPulledAt: new Date().toISOString() }, lastSyncedAt: new Date() } })
}
console.log(`\nDONE processed ${n} items -> ${status} (remaining ${remaining})`)
console.log('counts', JSON.stringify(counts))
if (errorKeys.length) console.log('errors', JSON.stringify(errors, null, 2))
await p.$disconnect()

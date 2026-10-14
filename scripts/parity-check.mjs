#!/usr/bin/env node
/**
 * Harvest ↔ Track2 parity report. READ-ONLY on both sides: Harvest GETs only, Track2 SELECTs only.
 *
 * Compares, for the account's connected Harvest:
 *   - clients / projects / tasks / people / contacts / expenses: totals, and active-vs-archived
 *     mismatches by name (Track2 rows matched to Harvest through MigrationIdMap)
 *   - invoices: count, total amount, amount due, plus every invoice whose total / due / state differs
 *   - time entries per year: entry count and hours (Harvest reports API vs Track2 rows)
 * Differences caused by Harvest edits after the last import are expected; the header prints when
 * that was so you can tell drift from a real gap.
 *
 * Usage: ACCOUNT_ID=acc_demo INTEGRATION_ENC_KEY=... node --env-file=.env scripts/parity-check.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createDecipheriv, createHash } from 'node:crypto'

const ENC_KEY = process.env.INTEGRATION_ENC_KEY
if (!ENC_KEY || ENC_KEY.length < 16) { console.error('Set INTEGRATION_ENC_KEY.'); process.exit(1) }
const HARVEST_API = 'https://api.harvestapp.com/v2'
const CALL_DELAY_MS = 160 // ~6/s, under Harvest's 100 requests / 15s
const LIST_LIMIT = 25

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cents = (v) => (v == null || v === '' ? 0 : Math.round(Number(v) * 100))
const money = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const num = (n) => Number(n).toLocaleString('en-US')
const log = (m = '') => process.stdout.write(m + '\n')

function decrypt(payload) {
  const [v, ivB64, tagB64, dataB64] = payload.split(':')
  if (v !== 'v1') throw new Error('bad ciphertext')
  const key = createHash('sha256').update(ENC_KEY).digest()
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  d.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8')
}

const p = new PrismaClient()
const conn = await p.integrationConnection.findFirst({
  where: { provider: 'harvest', status: 'connected', ...(process.env.ACCOUNT_ID ? { accountId: process.env.ACCOUNT_ID } : {}) },
})
if (!conn) { console.error('No connected Harvest integration.'); await p.$disconnect(); process.exit(1) }
const accountId = conn.accountId
const token = decrypt(conn.secretsEnc.accessToken)
const acct = String(conn.config.harvestAccountId)

async function hget(path) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(`${HARVEST_API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Harvest-Account-Id': acct, 'User-Agent': 'Track2 Parity Check (read-only)', Accept: 'application/json' } })
    await sleep(CALL_DELAY_MS)
    if (res.ok) return res.json()
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')); await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(15000, 1000 * 2 ** a)); continue }
    throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 120)}`)
  }
  throw new Error(`GET ${path} exhausted retries`)
}
const qs = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
async function pullAll(resource, params = {}) {
  const out = []
  let page = 1
  for (let i = 0; i < 1000; i++) {
    const json = await hget(`/${resource}?${qs({ ...params, per_page: 2000, page })}`)
    out.push(...(json[resource] ?? []))
    if (!json.next_page) break
    page = json.next_page
  }
  return out
}
const totalOf = async (resource, params = {}) => (await hget(`/${resource}?${qs({ ...params, per_page: 1 })}`)).total_entries ?? 0

/** harvestId → Track2 local id, for one importer entity. */
async function idMap(entity) {
  const rows = await p.migrationIdMap.findMany({ where: { accountId, entity }, select: { harvestId: true, localId: true } })
  return new Map(rows.map((r) => [r.harvestId, r.localId]))
}

const issues = []
const row = (label, h, t) => {
  const d = t - h
  log(`  ${label.padEnd(34)} Harvest ${String(num(h)).padStart(10)}   Track2 ${String(num(t)).padStart(10)}   ${d === 0 ? 'OK' : `DIFF ${d > 0 ? '+' : ''}${num(d)}`}`)
  if (d !== 0) issues.push(`${label}: Harvest ${num(h)} vs Track2 ${num(t)}`)
}

const lastPull = conn.config.lastPulledAt ? new Date(conn.config.lastPulledAt) : null
log(`Harvest ↔ Track2 parity (account ${accountId}, Harvest ${acct}) — ${new Date().toISOString()}`)
log(`Last Harvest pull imported into Track2: ${lastPull ? lastPull.toISOString() : 'unknown'} (Harvest edits after this are expected differences)`)

// ---- Directory entities: totals + active/archived mismatches --------------------------------------
const DIRECTORY = [
  { resource: 'clients', entity: 'client', model: 'client', active: true, name: (h) => h.name },
  { resource: 'projects', entity: 'project', model: 'project', active: true, name: (h) => `${h.client?.name ?? '?'} / ${h.name}` },
  { resource: 'tasks', entity: 'task', model: 'task', active: true, name: (h) => h.name },
  { resource: 'users', entity: 'user', model: 'user', active: true, name: (h) => `${h.first_name} ${h.last_name}` },
  { resource: 'contacts', entity: 'contact', model: 'clientContact', active: false, name: (h) => `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim() },
]
for (const d of DIRECTORY) {
  log(`\n▶ ${d.resource}`)
  const harvest = await pullAll(d.resource)
  const map = await idMap(d.entity)
  const local = d.active
    ? await p[d.model].findMany({ where: { id: { in: [...map.values()] } }, select: { id: true, isActive: true } })
    : await p[d.model].findMany({ where: { id: { in: [...map.values()] } }, select: { id: true } })
  const byId = new Map(local.map((r) => [r.id, r]))
  row(`${d.resource} (all)`, harvest.length, harvest.filter((h) => byId.has(map.get(String(h.id)))).length)
  const missing = harvest.filter((h) => !byId.has(map.get(String(h.id))))
  if (missing.length) log(`    missing in Track2 (${missing.length}): ${missing.slice(0, LIST_LIMIT).map(d.name).join('; ')}${missing.length > LIST_LIMIT ? ' …' : ''}`)
  if (d.active) {
    const hActive = harvest.filter((h) => h.is_active).length
    const tActive = harvest.filter((h) => byId.get(map.get(String(h.id)))?.isActive).length
    row(`${d.resource} active`, hActive, tActive)
    const wrong = harvest.filter((h) => { const t = byId.get(map.get(String(h.id))); return t && t.isActive !== !!h.is_active })
    if (wrong.length) log(`    active/archived differs (${wrong.length}): ${wrong.slice(0, LIST_LIMIT).map((h) => `${d.name(h)} [Harvest ${h.is_active ? 'active' : 'archived'}]`).join('; ')}${wrong.length > LIST_LIMIT ? ' …' : ''}`)
  }
}

// ---- Invoices ----------------------------------------------------------------------------------
log('\n▶ invoices')
const hInv = await pullAll('invoices')
const invMap = await idMap('invoice')
const tInv = await p.invoice.findMany({ where: { id: { in: [...invMap.values()] } }, select: { id: true, number: true, status: true, totalCents: true, paidCents: true } })
const tInvById = new Map(tInv.map((r) => [r.id, r]))
const pairs = hInv.map((h) => ({ h, t: tInvById.get(invMap.get(String(h.id))) }))
row('invoices (count)', hInv.length, pairs.filter((x) => x.t).length)
row('invoices total amount (cents)', hInv.reduce((a, h) => a + cents(h.amount), 0), pairs.reduce((a, x) => a + (x.t?.totalCents ?? 0), 0))
row('invoices amount due (cents)', hInv.reduce((a, h) => a + cents(h.due_amount), 0), pairs.reduce((a, x) => a + (x.t ? x.t.totalCents - x.t.paidCents : 0), 0))
const STATE = { draft: ['draft'], open: ['open'], paid: ['paid'], closed: ['closed', 'written_off'] }
const invDiffs = pairs.filter(({ h, t }) => t && (t.totalCents !== cents(h.amount) || t.totalCents - t.paidCents !== cents(h.due_amount) || !(STATE[h.state] ?? [h.state]).includes(t.status)))
const invMissing = pairs.filter((x) => !x.t).map((x) => x.h.number)
if (invMissing.length) log(`    missing in Track2 (${invMissing.length}): ${invMissing.slice(0, LIST_LIMIT).join(', ')}${invMissing.length > LIST_LIMIT ? ' …' : ''}`)
if (invDiffs.length) {
  issues.push(`invoices with a different total/due/state: ${invDiffs.length}`)
  log(`    differ (${invDiffs.length}):`)
  for (const { h, t } of invDiffs.slice(0, LIST_LIMIT)) {
    log(`      #${h.number}: Harvest ${h.state} total ${money(cents(h.amount))} due ${money(cents(h.due_amount))} (updated ${h.updated_at}) | Track2 ${t.status} total ${money(t.totalCents)} due ${money(t.totalCents - t.paidCents)}`)
  }
}

// ---- Expenses ----------------------------------------------------------------------------------
log('\n▶ expenses')
const hExp = await pullAll('expenses')
const expMap = await idMap('expense')
const tExp = await p.expense.findMany({ where: { id: { in: [...expMap.values()] } }, select: { id: true, totalCents: true } })
const tExpById = new Map(tExp.map((r) => [r.id, r]))
row('expenses (count)', hExp.length, hExp.filter((h) => tExpById.has(expMap.get(String(h.id)))).length)
row('expenses total (cents)', hExp.reduce((a, h) => a + cents(h.total_cost), 0), hExp.reduce((a, h) => a + (tExpById.get(expMap.get(String(h.id)))?.totalCents ?? 0), 0))

// ---- Time entries per year ---------------------------------------------------------------------
log('\n▶ time entries by year (Track2 = all entries; "keyed" = carrying a Harvest id)')
const tYears = await p.$queryRaw`
  SELECT EXTRACT(YEAR FROM "spentDate")::int AS y, COUNT(*)::int AS n, COALESCE(SUM(minutes),0)::bigint AS m,
         COUNT("harvestId")::int AS keyed
  FROM "TimeEntry" WHERE "accountId" = ${accountId} GROUP BY 1 ORDER BY 1`
const byYear = new Map(tYears.map((r) => [r.y, r]))
const thisYear = new Date().getUTCFullYear()
const firstYear = Math.min(...tYears.map((r) => r.y), thisYear)
for (let y = firstYear; y <= thisYear; y++) {
  const from = `${y}0101`
  const to = `${y}1231`
  const hCount = await totalOf('time_entries', { from: `${y}-01-01`, to: `${y}-12-31` })
  // reports/time returns { results: [...] } (one year max per request).
  let hHours = 0
  let page = 1
  for (let i = 0; i < 50; i++) {
    const json = await hget(`/reports/time/clients?${qs({ from, to, page, per_page: 1000 })}`)
    hHours += (json.results ?? []).reduce((a, r) => a + Number(r.total_hours ?? 0), 0)
    if (!json.next_page) break
    page = json.next_page
  }
  const t = byYear.get(y) ?? { n: 0, m: 0n, keyed: 0 }
  const tHours = Number(t.m) / 60
  const hDiff = Math.round((tHours - hHours) * 100) / 100
  log(`  ${y}  entries Harvest ${String(num(hCount)).padStart(7)}  Track2 ${String(num(t.n)).padStart(7)} (keyed ${num(t.keyed)})   hours Harvest ${hHours.toFixed(2).padStart(10)}  Track2 ${tHours.toFixed(2).padStart(10)}   ${hCount === t.n && Math.abs(hDiff) < 0.05 ? 'OK' : `DIFF entries ${t.n - hCount >= 0 ? '+' : ''}${t.n - hCount}, hours ${hDiff >= 0 ? '+' : ''}${hDiff}`}`)
  if (hCount !== t.n || Math.abs(hDiff) >= 0.05) issues.push(`time ${y}: entries ${num(hCount)} vs ${num(t.n)}, hours ${hHours.toFixed(2)} vs ${tHours.toFixed(2)}`)
}

log(`\n${issues.length ? `${issues.length} difference(s):\n  - ${issues.join('\n  - ')}` : 'Parity: no differences.'}`)
await p.$disconnect()

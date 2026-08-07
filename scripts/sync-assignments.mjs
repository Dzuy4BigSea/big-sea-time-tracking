#!/usr/bin/env node
/**
 * Phase 4 — real Harvest assignment roster (spec 18 follow-up). The flat backup snapshot doesn't
 * include Harvest's per-project assignment endpoints, so time-derived assignments (from Phase 3)
 * miss: people assigned with no logged time, the project-manager flag, and per-assignment rate
 * overrides. This pulls `/projects/{id}/user_assignments` + `/task_assignments` from Harvest and
 * upserts the real roster ON TOP of the derived rows.
 *
 * Resumable + idempotent: each project is marked done in MigrationIdMap(entity='assignments_done')
 * after its assignments commit, so a re-run skips completed projects. Rate-limited for Harvest's
 * 100-req / 15s cap; fresh DB connection every N projects so no connection goes stale on a long run.
 *
 * Requires env: DATABASE_URL, INTEGRATION_ENC_KEY (same as Vercel). Optional: ACCOUNT_ID.
 * Usage: INTEGRATION_ENC_KEY=... node --env-file=.env scripts/sync-assignments.mjs [--dry]
 */
import { PrismaClient } from '@prisma/client'
import { createDecipheriv, createHash } from 'node:crypto'

const ENC_KEY = process.env.INTEGRATION_ENC_KEY
if (!ENC_KEY || ENC_KEY.length < 16) { console.error('Set INTEGRATION_ENC_KEY.'); process.exit(1) }
const DRY = process.argv.includes('--dry')
const HARVEST_API = 'https://api.harvestapp.com/v2'
const RECONNECT_EVERY = 200
const CALL_DELAY_MS = 160 // ~6/s, under 100/15s
const DONE = 'assignments_done'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100))

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
    const res = await fetch(`${HARVEST_API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Harvest-Account-Id': acct, 'User-Agent': 'Track2 Migration (admin)', Accept: 'application/json' } })
    if (res.ok) return res.json()
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')); await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(15000, 1000 * 2 ** a)); continue }
    throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 120)}`)
  }
  throw new Error(`GET ${path} exhausted retries`)
}
async function pullAll(token, acct, path, key) {
  const out = []; let page = 1
  for (let i = 0; i < 200; i++) {
    const json = await hget(token, acct, `${path}?per_page=100&page=${page}`)
    out.push(...((json[key]) ?? []))
    await sleep(CALL_DELAY_MS)
    if (!json.next_page) break
    page = json.next_page
  }
  return out
}

let p = new PrismaClient()
const conn = await p.integrationConnection.findFirst({ where: { provider: 'harvest', status: 'connected' } })
if (!conn) { console.error('No connected Harvest integration.'); await p.$disconnect(); process.exit(1) }
const token = decrypt(conn.secretsEnc.accessToken)
const acct = String(conn.config.harvestAccountId)
const accountId = process.env.ACCOUNT_ID || conn.accountId

// id-maps (harvestId -> localId) from phases 1–2.
const rows = await p.migrationIdMap.findMany({ where: { accountId, entity: { in: ['project', 'user', 'task', DONE] } }, select: { entity: true, harvestId: true, localId: true } })
const projectMap = new Map(), userMap = new Map(), taskMap = new Map(), done = new Set()
for (const r of rows) {
  if (r.entity === 'project') projectMap.set(r.harvestId, r.localId)
  else if (r.entity === 'user') userMap.set(r.harvestId, r.localId)
  else if (r.entity === 'task') taskMap.set(r.harvestId, r.localId)
  else if (r.entity === DONE) done.add(r.harvestId)
}
const projects = [...projectMap.entries()].filter(([hid]) => !done.has(hid))
console.log(`\n▶ Phase 4 — assignment roster${DRY ? ' (DRY)' : ''}`)
console.log(`  account=${accountId}  harvest=${acct}  projects to sync=${projects.length} (of ${projectMap.size}, ${done.size} already done)`)

let uUp = 0, tUp = 0, pmSet = 0, rateSet = 0, uSkip = 0, tSkip = 0, n = 0, apiErr = 0
for (const [hid, localProjectId] of projects) {
  n++
  try {
    const [uas, tas] = await Promise.all([
      pullAll(token, acct, `/projects/${hid}/user_assignments`, 'user_assignments'),
      pullAll(token, acct, `/projects/${hid}/task_assignments`, 'task_assignments'),
    ])
    if (!DRY) {
      for (const ua of uas) {
        const userId = userMap.get(String(ua.user?.id))
        if (!userId) { uSkip++; continue }
        const rate = cents(ua.hourly_rate)
        const data = { isProjectManager: !!ua.is_project_manager, isActive: ua.is_active ?? true, ...(rate != null ? { hourlyRateCents: rate } : {}) }
        await p.projectUserAssignment.upsert({
          where: { projectId_userId: { projectId: localProjectId, userId } },
          create: { accountId, projectId: localProjectId, userId, ...data },
          update: data,
        })
        uUp++; if (data.isProjectManager) pmSet++; if (rate != null) rateSet++
      }
      for (const ta of tas) {
        const taskId = taskMap.get(String(ta.task?.id))
        if (!taskId) { tSkip++; continue }
        const rate = cents(ta.hourly_rate)
        const data = { billable: ta.billable ?? true, isActive: ta.is_active ?? true, ...(rate != null ? { hourlyRateCents: rate } : {}) }
        await p.projectTaskAssignment.upsert({
          where: { projectId_taskId: { projectId: localProjectId, taskId } },
          create: { accountId, projectId: localProjectId, taskId, ...data },
          update: data,
        })
        tUp++
      }
      await p.migrationIdMap.upsert({
        where: { accountId_entity_harvestId: { accountId, entity: DONE, harvestId: hid } },
        create: { accountId, entity: DONE, harvestId: hid, localId: 'done' },
        update: {},
      })
    } else {
      uUp += uas.length; tUp += tas.length
    }
  } catch (e) {
    apiErr++
    console.log(`  ERR project ${hid}: ${String(e.message).slice(0, 120)}`)
  }
  if (n % 50 === 0) process.stdout.write(`\r  ${n}/${projects.length} projects  userAsg=${uUp} taskAsg=${tUp} PM=${pmSet} rates=${rateSet} apiErr=${apiErr}   `)
  if (n % RECONNECT_EVERY === 0) { await p.$disconnect(); p = new PrismaClient() } // avoid stale long-lived connection
}
console.log(`\n\nDone. projects synced=${n}  userAssignments upserted=${uUp} (PM=${pmSet}, rates=${rateSet}, skipped=${uSkip})  taskAssignments=${tUp} (skipped=${tSkip})  apiErrors=${apiErr}`)
if (DRY) console.log('(dry — no writes, no done-markers. Re-run without --dry to apply.)')
await p.$disconnect()

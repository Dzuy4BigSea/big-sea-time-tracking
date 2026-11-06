/**
 * Server-action permission audit.
 *
 * 1. Coverage: every exported action in every `'use server'` file under app/ has an ACTION_POLICY
 *    entry (so a new feature can't ship without a declared guard), and no entry is stale.
 * 2. Enforcement: each action's source (including the local guard helpers it calls) authenticates
 *    and references the capability its policy declares. This is a static check: it proves the
 *    capability is wired in, and the matrix below proves what that capability means per role.
 * 3. Role × function matrix: for every guarded action, exactly the expected profiles get access,
 *    and per-user overrides (grant / revoke) move access the same way for every function.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTION_POLICY, type ActionGuard } from './actionPolicy'
import { ALL_CAPABILITIES, ALL_PROFILES, can, projectManagementScoped, type Capability, type PermissionProfile } from './permissions'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const APP = join(ROOT, 'app')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const isServerActionFile = (src: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(src)

/** Top-level functions in a file: name → { exported, body } (body runs to the next top-level function). */
function functionsOf(src: string): Map<string, { exported: boolean; body: string }> {
  const re = /^(export\s+)?async\s+function\s+(\w+)\s*\(/gm
  const hits = [...src.matchAll(re)]
  const out = new Map<string, { exported: boolean; body: string }>()
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : src.length
    out.set(m[2], { exported: !!m[1], body: src.slice(m.index, end) })
  })
  return out
}

/** A function's body plus the bodies of every local helper it (transitively) calls. */
function evidence(fns: Map<string, { body: string }>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return ''
  seen.add(name)
  const body = fns.get(name)?.body ?? ''
  let out = body
  for (const helper of fns.keys()) {
    if (helper !== name && new RegExp(`\\b${helper}\\(`).test(body)) out += '\n' + evidence(fns, helper, seen)
  }
  return out
}

interface Found {
  key: string
  file: string
  evidence: string
}

const found: Found[] = walk(APP)
  .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
  .flatMap((p) => {
    const src = readFileSync(p, 'utf8')
    if (!isServerActionFile(src)) return []
    const rel = relative(APP, p).split(sep).join('/')
    const fns = functionsOf(src)
    return [...fns.entries()].filter(([, f]) => f.exported).map(([name]) => ({ key: `${rel}#${name}`, file: rel, evidence: evidence(fns, name) }))
  })

const isCap = (g: ActionGuard): g is Extract<ActionGuard, { cap: Capability }> => 'cap' in g
const AUTH = /\b(requireUser|getCurrentUser)\(/

describe('server-action policy coverage', () => {
  it('finds the server actions (sanity)', () => {
    expect(found.length).toBeGreaterThan(100)
  })

  it('every exported server action has a declared policy (add new features to modules/shared/actionPolicy.ts)', () => {
    const missing = found.map((f) => f.key).filter((k) => !(k in ACTION_POLICY))
    expect(missing).toEqual([])
  })

  it('has no stale policy entries', () => {
    const keys = new Set(found.map((f) => f.key))
    expect(Object.keys(ACTION_POLICY).filter((k) => !keys.has(k))).toEqual([])
  })
})

describe('server-action enforcement (static)', () => {
  for (const f of found) {
    const g = ACTION_POLICY[f.key]
    if (!g) continue
    it(`${f.key} → ${isCap(g) ? [g.cap, ...(g.also ?? [])].join(' + ') : Object.keys(g)[0]}`, () => {
      if ('public' in g) return
      expect(f.evidence, 'must authenticate').toMatch(AUTH)
      if (isCap(g)) {
        for (const c of [g.cap, ...(g.also ?? [])]) expect(f.evidence, `must check '${c}'`).toContain(`'${c}'`)
        if (g.scope === 'managed_projects') expect(f.evidence, 'must scope Project Managers').toContain('projectManagementScoped(')
      }
      if ('self' in g) expect(f.evidence, 'must re-authorize the subject').toMatch(/\b(mayActForOnProject|resolveSubjectUserId)\(/)
      if ('owner' in g) expect(f.evidence, 'must scope to the signed-in user').toMatch(/\buserId\b/)
    })
  }

  it('no server action compares profile names directly (overrides would be ignored); use can()', () => {
    const offenders = found.filter((f) => /permissionProfile\s*[!=]==\s*'/.test(f.evidence)).map((f) => f.key)
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Who should be able to do what. Written in business terms, independently of the policy file:
// if either the policy or the profile grid drifts, this table catches it.
// ---------------------------------------------------------------------------

const P = (...ps: PermissionProfile[]) => ps
const ADMIN = P('administrator')
const MONEY = P('accounting', 'executive_manager', 'administrator')
const PROJECTS = P('project_manager', 'executive_manager', 'administrator')
const CLIENTS = P('project_manager', 'accounting', 'executive_manager', 'administrator')
const PEOPLE = P('people_admin', 'executive_manager', 'administrator')

/** First matching rule wins. */
const EXPECTED: [RegExp, PermissionProfile[], string][] = [
  [/^projects\/actions\.ts#(setProjectUserRate|setProjectTaskRate)Action$/, ADMIN, 'Rates are a money decision'],
  [/^(projects|tasks)\//, PROJECTS, 'Project setup'],
  [/^clients\//, CLIENTS, 'Clients'],
  [/^team\/actions\.ts#(addPersonRate|assignPeopleToManager|removeAssignedPerson)Action$/, ADMIN, 'Rates and manager assignments'],
  [/^team\//, PEOPLE, 'People'],
  [/^invoices\/configure\//, ADMIN, 'Invoice configuration is an account setting'],
  [/^(invoices|estimates|retainers|recurring)\//, MONEY, 'Billing'],
  [/^(settings|expenses)\//, ADMIN, 'Account settings'],
]

const capEntries = Object.entries(ACTION_POLICY).filter((e): e is [string, Extract<ActionGuard, { cap: Capability }>] => isCap(e[1]))
const actor = (permissionProfile: PermissionProfile, permissionOverrides?: { grant?: Capability[]; revoke?: Capability[] }) => ({
  permissionProfile,
  permissionOverrides,
})
const allowed = (g: Extract<ActionGuard, { cap: Capability }>, a: ReturnType<typeof actor>) =>
  [g.cap, ...(g.also ?? [])].every((c) => can(a, c))

describe('role × function access matrix', () => {
  for (const [key, g] of capEntries) {
    const rule = EXPECTED.find(([re]) => re.test(key))
    it(`${g.feature} (${key})`, () => {
      expect(rule, `no expected-access rule matches ${key}`).toBeDefined()
      const got = ALL_PROFILES.filter((p) => allowed(g, actor(p)))
      expect(new Set(got)).toEqual(new Set(rule![1]))
    })
  }

  it('Project Managers manage only their own projects; everyone else with the capability is account-wide', () => {
    expect(projectManagementScoped(actor('project_manager'))).toBe(true)
    for (const p of ['executive_manager', 'administrator'] as PermissionProfile[]) expect(projectManagementScoped(actor(p))).toBe(false)
  })

  it('every profile may track their own time and expenses (self actions)', () => {
    for (const p of ALL_PROFILES) expect(can(actor(p), 'track_own_time')).toBe(true)
  })
})

describe('overrides apply uniformly to every function', () => {
  for (const [key, g] of capEntries) {
    const needed = [g.cap, ...(g.also ?? [])]
    it(`${key}: a Member granted ${needed.join(' + ')} gains it; an Administrator revoked ${g.cap} loses it`, () => {
      expect(allowed(g, actor('member'))).toBe(false)
      expect(allowed(g, actor('member', { grant: needed }))).toBe(true)
      expect(allowed(g, actor('administrator', { revoke: [g.cap] }))).toBe(false)
    })
  }
})

// ---------------------------------------------------------------------------
// Dead capabilities: a toggle on the Permissions tab that nothing enforces is a lie to the admin.
// ---------------------------------------------------------------------------

/** Capabilities shown on the Permissions tab that no code path checks yet (remove when built). */
const NOT_YET_ENFORCED: Capability[] = ['approve_timesheets']

describe('every capability is enforced somewhere', () => {
  const sources = ['app', 'lib', 'modules', 'components']
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/[\\/]modules[\\/]shared[\\/](permissions|actionPolicy)\.ts$/.test(p))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n')

  it('lists exactly the capabilities that are not checked anywhere', () => {
    const unused = ALL_CAPABILITIES.filter((c) => !sources.includes(`'${c}'`))
    expect(new Set(unused)).toEqual(new Set(NOT_YET_ENFORCED))
  })
})

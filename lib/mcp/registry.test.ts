/**
 * The real MCP tool registry behind the JSON-RPC handler, with Prisma mocked: checks the advertised
 * surface (Harvest tool names) and that permission checks fire before any data is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// React `cache` only exists in the react-server build; make it a pass-through for unit tests.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

const db = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  module: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  projectUserAssignment: { count: vi.fn(), findMany: vi.fn() },
  timeEntry: { findMany: vi.fn(), findFirst: vi.fn() },
  invoice: { findMany: vi.fn() },
  project: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { handleRpc } from '@/modules/mcp/jsonrpc'
import { MCP_TOOLS } from './registry'
import { makeContext } from './context'
import type { CurrentUser } from '@/lib/session'

const member: CurrentUser = { userId: 'mem1', accountId: 'acct1', permissionProfile: 'member', permissionOverrides: null }
const pm: CurrentUser = { userId: 'pm1', accountId: 'acct1', permissionProfile: 'project_manager', permissionOverrides: null }
const admin: CurrentUser = { userId: 'adm1', accountId: 'acct1', permissionProfile: 'administrator', permissionOverrides: null }

const NOW = new Date('2026-10-14T15:00:00Z')
async function callTool(user: CurrentUser, name: string, args: Record<string, unknown> = {}) {
  const r = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, makeContext(user, 'tok1', NOW), MCP_TOOLS)) as {
    result: { isError?: boolean; structuredContent: Record<string, any> }
  }
  return r.result
}

beforeEach(() => {
  vi.clearAllMocks()
  db.account.findUnique.mockResolvedValue({ timezone: 'America/New_York', weekStartsOn: 'monday', timeRounding: 'none', timeEntryNotes: 'optional' })
})

describe('MCP registry', () => {
  it('exposes the Harvest tool names (minus send/payment/delete-invoice)', async () => {
    const r = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeContext(member, 't'), MCP_TOOLS)) as { result: { tools: { name: string }[] } }
    const names = r.result.tools.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'add_task_to_project', 'assign_user_to_project', 'create_client', 'create_expense', 'create_invoice', 'create_invoice_from_tracked_time',
        'create_project', 'create_task', 'delete_time_entry', 'get_account_settings', 'get_expense', 'get_invoice', 'get_project_budget',
        'get_running_timer', 'get_time_report', 'list_clients', 'list_expense_categories', 'list_expenses', 'list_invoices',
        'list_project_assignments', 'list_projects', 'list_tasks', 'list_time_entries', 'list_users', 'log_time', 'remove_task_from_project',
        'start_timer', 'stop_timer', 'unassign_user_from_project', 'update_client', 'update_expense', 'update_project', 'update_task',
        'update_time_entry',
      ].sort(),
    )
    expect(names).not.toContain('send_invoice')
    expect(names).not.toContain('record_payment')
  })

  it('get_account_settings maps Track2 preferences to Harvest fields, with today in the account timezone', async () => {
    db.account.findUniqueOrThrow.mockResolvedValue({ name: 'Big Sea', timeEntryNotes: 'required', timeRounding: 'nearest_15', timerMode: 'duration', weekStartsOn: 'monday', timeDisplay: 'hh_mm', baseCurrency: 'USD' })
    db.module.findUnique.mockResolvedValue(null)
    const r = await callTool(member, 'get_account_settings')
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toMatchObject({
      approval_required: false,
      notes_required: true,
      time_rounding: { enabled: true, style: 'nearest', round_to_minutes: 15 },
      wants_timestamp_timers: false,
      week_start_day: 'Monday',
      time_format: 'hours_minutes',
      invoice_feature: true,
      expense_feature: true,
      timezone: 'America/New_York',
      today: '2026-10-14',
    })
  })

  it('a member can’t read someone else’s time (forbidden, no query)', async () => {
    const r = await callTool(member, 'list_time_entries', { user_ids: ['someone-else'] })
    expect(r.isError).toBe(true)
    expect(r.structuredContent.error.code).toBe('forbidden')
    expect(db.timeEntry.findMany).not.toHaveBeenCalled()
  })

  it('a member’s own time list is scoped to them', async () => {
    db.timeEntry.findMany.mockResolvedValue([])
    const r = await callTool(member, 'list_time_entries', { from: '2026-10-01', to: '2026-10-14' })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toMatchObject({ time_entries: [], truncated: false, next_cursor: null, scope_limited: false })
    const where = db.timeEntry.findMany.mock.calls[0][0].where
    expect(where.accountId).toBe('acct1')
    expect(where.AND).toContainEqual({ userId: { in: ['mem1'] } })
  })

  it('a project manager’s list is limited to own + managed projects and flagged scope_limited', async () => {
    db.projectUserAssignment.findMany.mockResolvedValue([{ projectId: 'projA' }])
    db.timeEntry.findMany.mockResolvedValue([])
    const r = await callTool(pm, 'list_time_entries', {})
    expect(r.structuredContent.scope_limited).toBe(true)
    const where = db.timeEntry.findMany.mock.calls[0][0].where
    expect(where.AND).toContainEqual({ OR: [{ userId: 'pm1' }, { projectId: { in: ['projA'] } }] })
  })

  it('a member can’t log time for someone else', async () => {
    const r = await callTool(member, 'log_time', { project_id: 'p', task_id: 't', hours: 1, user_id: 'someone-else' })
    expect(r.structuredContent.error.code).toBe('forbidden')
  })

  it('a project manager can’t log time for a teammate on a project they don’t manage', async () => {
    db.user.findUnique.mockResolvedValue({ accountId: 'acct1' })
    db.projectUserAssignment.count.mockResolvedValue(1) // the teammate is on one of the PM's projects…
    db.projectUserAssignment.findMany.mockResolvedValue([{ projectId: 'projA' }]) // …but not this one
    const r = await callTool(pm, 'log_time', { project_id: 'projB', task_id: 't', hours: 1, user_id: 'teammate' })
    expect(r.structuredContent.error.code).toBe('forbidden')
    expect(r.structuredContent.error.message).toMatch(/don’t manage/)
  })

  it('invoices require invoice permission', async () => {
    const r = await callTool(member, 'list_invoices')
    expect(r.structuredContent.error.code).toBe('forbidden')
    expect(db.invoice.findMany).not.toHaveBeenCalled()
    const w = await callTool(pm, 'create_invoice', { client_id: 'c1' })
    expect(w.structuredContent.error.code).toBe('forbidden')
  })

  it('members can’t create projects or clients', async () => {
    expect((await callTool(member, 'create_project', { name: 'X', client_id: 'c' })).structuredContent.error.code).toBe('forbidden')
    expect((await callTool(member, 'create_client', { name: 'X' })).structuredContent.error.code).toBe('forbidden')
  })

  it('get_running_timer: member asking for another user is forbidden; admin gets null for an idle user', async () => {
    expect((await callTool(member, 'get_running_timer', { user_id: 'x' })).structuredContent.error.code).toBe('forbidden')
    db.timeEntry.findFirst.mockResolvedValue(null)
    const r = await callTool(admin, 'get_running_timer', { user_id: 'x' })
    expect(r.structuredContent).toEqual({ running_timer: null, scope_limited: false })
  })

  it('an unknown project in get_project_budget is not_found', async () => {
    db.project.findFirst.mockResolvedValue(null)
    const r = await callTool(admin, 'get_project_budget', { project_id: 'nope' })
    expect(r.structuredContent.error.code).toBe('not_found')
  })
})

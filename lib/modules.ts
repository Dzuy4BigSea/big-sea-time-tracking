import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export interface ModuleFlags {
  timeTracking: boolean
  expenseTracking: boolean
  timesheetApproval: boolean
  team: boolean
  invoices: boolean
  estimates: boolean
  clientDashboard: boolean
  activityLog: boolean
}

export const DEFAULT_MODULES: ModuleFlags = {
  timeTracking: true,
  expenseTracking: true,
  timesheetApproval: false,
  team: true,
  invoices: true,
  estimates: false,
  clientDashboard: true,
  activityLog: false,
}

export async function getModules(accountId: string): Promise<ModuleFlags> {
  const row = await prisma.module.findUnique({ where: { accountId } })
  if (!row) return DEFAULT_MODULES
  return {
    timeTracking: row.timeTracking,
    expenseTracking: row.expenseTracking,
    timesheetApproval: row.timesheetApproval,
    team: row.team,
    invoices: row.invoices,
    estimates: row.estimates,
    clientDashboard: row.clientDashboard,
    activityLog: row.activityLog,
  }
}

/** Guard a module-gated page: redirects home when the feature is switched off (AC-MOD-001). */
export async function requireModule(accountId: string, key: keyof ModuleFlags): Promise<void> {
  const modules = await getModules(accountId)
  if (!modules[key]) redirect('/')
}

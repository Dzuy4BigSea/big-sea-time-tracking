import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { PreferencesForm } from '@/components/PreferencesForm'
import { ModulesForm } from '@/components/ModulesForm'
import { CategoryManager } from '@/components/CategoryManager'
import { AppearanceForm } from '@/components/AppearanceForm'
import { getInvoiceAppearance } from '@/lib/appearance'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    redirect('/')
  }

  const [account, moduleRow, categories, appearance] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    prisma.module.findUnique({ where: { accountId } }),
    prisma.expenseCategory.findMany({ where: { accountId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
    getInvoiceAppearance(accountId),
  ])
  if (!account) redirect('/')

  const modules = {
    timeTracking: moduleRow?.timeTracking ?? true,
    expenseTracking: moduleRow?.expenseTracking ?? true,
    timesheetApproval: moduleRow?.timesheetApproval ?? false,
    team: moduleRow?.team ?? true,
    invoices: moduleRow?.invoices ?? true,
    estimates: moduleRow?.estimates ?? false,
    clientDashboard: moduleRow?.clientDashboard ?? true,
    activityLog: moduleRow?.activityLog ?? false,
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-gray-500">Account preferences, feature modules, and expense categories.</p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Preferences</h2>
        <PreferencesForm
          prefs={{
            name: account.name,
            timezone: account.timezone,
            baseCurrency: account.baseCurrency,
            dateFormat: account.dateFormat,
            fiscalYearStartMonth: account.fiscalYearStartMonth,
            defaultCapacityHours: Number(account.defaultCapacityHours),
            weekStartsOn: account.weekStartsOn,
            timeRounding: account.timeRounding,
            timeEntryNotes: account.timeEntryNotes,
            timeFormatClock: account.timeFormatClock,
            timeDisplay: account.timeDisplay,
            timerMode: account.timerMode,
            expenseReimbursement: account.expenseReimbursement,
          }}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Modules</h2>
        <ModulesForm modules={modules} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Invoice appearance</h2>
        <AppearanceForm
          values={{
            brandColor: appearance.brandColor,
            documentTitle: appearance.documentTitle,
            logoFileUrl: appearance.logoFileUrl,
            showDocumentTitle: appearance.showDocumentTitle,
            showDescriptionCol: appearance.showDescriptionCol,
            showQuantityCol: appearance.showQuantityCol,
            showUnitPriceCol: appearance.showUnitPriceCol,
            showAmountCol: appearance.showAmountCol,
          }}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Expense categories</h2>
        <CategoryManager
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            unitName: c.unitName,
            unitPriceCents: c.unitPriceCents,
            isActive: c.isActive,
          }))}
        />
      </section>
    </div>
  )
}

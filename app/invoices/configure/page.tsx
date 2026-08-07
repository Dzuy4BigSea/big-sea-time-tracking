import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { getInvoiceLabels } from '@/lib/invoiceLabels'
import { getMessageTemplate, MESSAGE_KINDS } from '@/lib/messageTemplates'
import { InvoiceLabelsForm } from '@/components/InvoiceLabelsForm'
import { InvoiceMessageForm } from '@/components/InvoiceMessageForm'
import {
  addItemTypeAction,
  deleteItemTypeAction,
  addSenderAction,
  setDefaultSenderAction,
  deleteSenderAction,
} from '@/app/invoices/configure/actions'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview', href: '/invoices' },
  { key: 'recurring', label: 'Recurring', href: '/recurring' },
  { key: 'retainers', label: 'Retainers', href: '/retainers' },
  { key: 'uninvoiced', label: 'Uninvoiced', href: '/reports' },
  { key: 'configure', label: 'Configure', href: '/invoices/configure' },
]

const SECTIONS = [
  { key: 'labels', label: 'Field labels' },
  { key: 'messages', label: 'Messages' },
  { key: 'items', label: 'Item types' },
  { key: 'senders', label: 'Sender addresses' },
]

export default async function ConfigurePage({ searchParams }: { searchParams: { section?: string; company?: string } }) {
  const actor = await requireUser()
  await requireModule(actor.accountId, 'invoices')
  const canEdit = can(
    { permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides },
    'edit_account_settings',
  )
  const section = SECTIONS.some((s) => s.key === searchParams.section) ? searchParams.section! : 'labels'

  const entities = await prisma.businessEntity.findMany({
    where: { accountId: actor.accountId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true, name: true, code: true },
  })
  // Scope for language editing: '' = account default, else a company id.
  const scope = entities.some((e) => e.id === searchParams.company) ? searchParams.company! : ''
  const scopeId = scope || null

  const [labels, messages, itemTypes, senders] = await Promise.all([
    getInvoiceLabels(actor.accountId, scopeId),
    Promise.all(MESSAGE_KINDS.map(async (m) => ({ ...m, template: await getMessageTemplate(actor.accountId, m.kind, scopeId) }))),
    prisma.itemType.findMany({ where: { accountId: actor.accountId }, orderBy: [{ isSystemDefault: 'desc' }, { name: 'asc' }] }),
    prisma.senderAddress.findMany({ where: { accountId: actor.accountId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
  ])
  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ section, ...(scope ? { company: scope } : {}), ...over })
    return `/invoices/configure?${p.toString()}`
  }
  const languageSection = section === 'labels' || section === 'messages'

  return (
    <div>
      <h1 className="mb-3 text-2xl font-semibold">Invoices</h1>

      {/* Top tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 pb-2 ${t.key === 'configure' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!canEdit && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You can view these settings but need the “edit account settings” permission to change them.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
        {/* Section nav */}
        <nav className="flex flex-row gap-1 lg:flex-col">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              href={`/invoices/configure?section=${s.key}${scope ? `&company=${scope}` : ''}`}
              className={`rounded px-3 py-1.5 text-sm ${s.key === section ? 'bg-brand-teal-50 font-medium text-brand-teal' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0">
          {/* Company scope selector — only meaningful for the language sections */}
          {languageSection && entities.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <span className="pl-1 text-xs uppercase tracking-wide text-gray-400">Editing for</span>
              <Link href={qp({ company: '' })} className={`rounded-full px-3 py-1 text-sm ${!scope ? 'bg-brand-teal text-white' : 'border border-gray-300 text-gray-600 hover:bg-white'}`}>
                All companies (default)
              </Link>
              {entities.map((e) => (
                <Link key={e.id} href={qp({ company: e.id })} className={`rounded-full px-3 py-1 text-sm ${scope === e.id ? 'bg-brand-teal text-white' : 'border border-gray-300 text-gray-600 hover:bg-white'}`}>
                  {e.name}
                </Link>
              ))}
            </div>
          )}

          {section === 'labels' && (
            <Section
              title="Field labels"
              desc={scope ? 'Overrides for this company only — blank fields inherit the account labels.' : 'Rename the text your clients see on the invoice document.'}
            >
              <InvoiceLabelsForm key={scope || 'account'} labels={labels} entityId={scope || undefined} />
            </Section>
          )}

          {section === 'messages' && (
            <Section
              title="Messages"
              desc={scope ? 'Email wording for this company only — blank fields inherit the account messages.' : 'The emails sent with invoices, reminders, and receipts. Placeholders are filled in per invoice.'}
            >
              <div className="space-y-4">
                {messages.map((m) => (
                  <InvoiceMessageForm key={`${scope}:${m.kind}`} kind={m.kind} label={m.label} description={m.description} placeholders={m.placeholders} template={m.template} entityId={scope || undefined} />
                ))}
              </div>
            </Section>
          )}

          {section === 'items' && (
            <Section title="Item types" desc="Categories for invoice and estimate line items. Service and Product are built in.">
              <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {itemTypes.map((it) => (
                      <tr key={it.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2 text-gray-800">
                          {it.name}
                          {it.isSystemDefault && <span className="ml-2 text-xs text-gray-400">built-in</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit && !it.isSystemDefault && (
                            <form action={deleteItemTypeAction}>
                              <input type="hidden" name="id" value={it.id} />
                              <button className="text-xs text-red-600 hover:underline">Remove</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <form action={addItemTypeAction} className="flex items-center gap-2">
                  <input name="name" placeholder="New item type" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add</button>
                </form>
              )}
            </Section>
          )}

          {section === 'senders' && (
            <Section title="Sender addresses" desc="The from-name and reply-to addresses available when sending invoices.">
              <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {senders.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2">
                          <span className="text-gray-800">{s.name}</span>{' '}
                          <span className="text-gray-500">&lt;{s.email}&gt;</span>
                          {s.isDefault && <span className="ml-2 rounded-full bg-brand-teal-50 px-2 py-0.5 text-xs text-brand-teal">Default</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit && (
                            <div className="flex items-center justify-end gap-3">
                              {!s.isDefault && (
                                <form action={setDefaultSenderAction}>
                                  <input type="hidden" name="id" value={s.id} />
                                  <button className="text-xs text-brand-teal hover:underline">Make default</button>
                                </form>
                              )}
                              <form action={deleteSenderAction}>
                                <input type="hidden" name="id" value={s.id} />
                                <button className="text-xs text-red-600 hover:underline">Remove</button>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {senders.length === 0 && (
                      <tr><td className="px-4 py-6 text-center text-gray-400">No sender addresses yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <form action={addSenderAction} className="flex flex-wrap items-center gap-2">
                  <input name="name" placeholder="Name (e.g. Big Sea Billing)" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  <input name="email" type="email" placeholder="billing@bigsea.co" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add</button>
                </form>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mb-4 text-sm text-gray-500">{desc}</p>
      {children}
    </div>
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, userCan } from '@/lib/session'

export const dynamic = 'force-dynamic'

export type SearchHit = {
  type: 'invoice' | 'project' | 'client' | 'task' | 'person'
  id: string
  title: string
  subtitle?: string
  href: string
  badge?: string
}

const LIMIT = 6 // per group

/**
 * Global top-bar search (Harvest parity). Case-insensitive `contains` across the
 * entities the team looks up most: invoice number/subject, projects, clients,
 * tasks, people. Account-scoped via the session.
 */
export async function GET(req: NextRequest) {
  // Middleware skips /api, so an expired/inactive session lands here: answer 401, not a 500.
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { accountId } = me
  // Invoices (and their amounts) only for people who can see invoices; people's emails only for
  // people managers. Everyone can still find projects, clients, tasks and teammates by name.
  const canInvoices = userCan(me, 'manage_invoices')
  const canAmounts = canInvoices && userCan(me, 'view_billable_rates')
  const canPeopleDetail = userCan(me, 'manage_people')
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 1) return NextResponse.json({ hits: [] })

  const ci = { contains: q, mode: 'insensitive' as const }

  const [invoices, projects, clients, tasks, people] = await Promise.all([
    canInvoices
      ? prisma.invoice.findMany({
      where: {
        accountId,
        OR: [{ number: ci }, { subject: ci }, { poNumber: ci }, { client: { name: ci } }],
      },
      select: { id: true, number: true, subject: true, status: true, totalCents: true, currency: true, client: { select: { name: true } } },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: LIMIT,
    })
      : Promise.resolve([]),
    prisma.project.findMany({
      where: { accountId, OR: [{ name: ci }, { code: ci }, { client: { name: ci } }] },
      select: { id: true, name: true, code: true, isActive: true, client: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: LIMIT,
    }),
    prisma.client.findMany({
      where: { accountId, name: ci },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: LIMIT,
    }),
    prisma.task.findMany({
      where: { accountId, name: ci },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: LIMIT,
    }),
    prisma.user.findMany({
      where: {
        accountId,
        OR: canPeopleDetail ? [{ firstName: ci }, { lastName: ci }, { email: ci }] : [{ firstName: ci }, { lastName: ci }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: LIMIT,
    }),
  ])

  const money = (cents: number, cur: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(cents / 100)

  const hits: SearchHit[] = [
    ...invoices.map((i): SearchHit => ({
      type: 'invoice',
      id: i.id,
      title: i.number ? `Invoice ${i.number}` : 'Draft invoice',
      subtitle: [i.client.name, i.subject].filter(Boolean).join(' · ') || undefined,
      href: `/invoices/${i.id}`,
      badge: canAmounts ? `${i.status} · ${money(i.totalCents, i.currency)}` : i.status,
    })),
    ...projects.map((p): SearchHit => ({
      type: 'project',
      id: p.id,
      title: p.code ? `[${p.code}] ${p.name}` : p.name,
      subtitle: p.client.name,
      href: `/projects/${p.id}`,
      badge: p.isActive ? undefined : 'archived',
    })),
    ...clients.map((c): SearchHit => ({
      type: 'client',
      id: c.id,
      title: c.name,
      href: `/clients/${c.id}`,
      badge: c.isActive ? undefined : 'archived',
    })),
    ...tasks.map((t): SearchHit => ({
      type: 'task',
      id: t.id,
      title: t.name,
      href: `/tasks`,
      badge: t.isActive ? undefined : 'archived',
    })),
    ...people.map((u): SearchHit => ({
      type: 'person',
      id: u.id,
      title: `${u.firstName} ${u.lastName}`.trim() || (canPeopleDetail ? u.email : 'Teammate'),
      subtitle: canPeopleDetail ? u.email : undefined,
      href: canPeopleDetail ? `/team/${u.id}` : '/team',
      badge: u.isActive ? undefined : 'inactive',
    })),
  ]

  return NextResponse.json({ hits })
}

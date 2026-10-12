/**
 * Manage > Clients list helpers (specs/24 §3 — Harvest parity): ordering, the contact summary line,
 * the "Filter by client or contact" search, and paging. Pure; no Prisma client calls.
 */
import type { Prisma } from '@prisma/client'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * Harvest's client order: names starting with a digit first, then alphabetical, case-insensitive,
 * with embedded numbers compared numerically ("Client 2" before "Client 10"). Done in code because
 * Postgres' ORDER BY depends on the database collation (under "C" it is case-sensitive).
 */
export function compareClientNames(a: string, b: string): number {
  const x = a.trim()
  const y = b.trim()
  const dx = /^\d/.test(x)
  const dy = /^\d/.test(y)
  if (dx !== dy) return dx ? -1 : 1
  return collator.compare(x, y) || (x < y ? -1 : x > y ? 1 : 0)
}

export function sortClientsByName<T extends { name: string }>(clients: T[]): T[] {
  return [...clients].sort((a, b) => compareClientNames(a.name, b.name))
}

export interface ContactSummary {
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phoneOffice: string | null
  phoneMobile: string | null
}

/** Display name; migrated contacts with only a last name store firstName "—". */
export function contactName(c: Pick<ContactSummary, 'firstName' | 'lastName'>): string {
  const first = c.firstName === '—' ? '' : c.firstName.trim()
  return [first, c.lastName.trim()].filter(Boolean).join(' ') || '—'
}

/** Harvest's second line under a contact: "Title, email, 612-840-4334 (office)" (blanks skipped). */
export function contactSubline(c: ContactSummary): string {
  const parts = [c.title?.trim(), c.email?.trim()]
  if (c.phoneOffice?.trim()) parts.push(`${c.phoneOffice.trim()} (office)`)
  if (c.phoneMobile?.trim()) parts.push(`${c.phoneMobile.trim()} (mobile)`)
  return parts.filter(Boolean).join(', ')
}

export type ClientStatus = 'active' | 'archived' | 'all'

export function parseClientStatus(raw: string | undefined): ClientStatus {
  return raw === 'archived' || raw === 'all' ? raw : 'active'
}

/**
 * The Prisma filter for the clients list, always scoped to `accountId` (INV-5). The search term
 * matches the client name, or any contact's first name, last name, email or full name — a contact
 * match brings back the whole client (all of its contacts are shown).
 */
export function clientListWhere(accountId: string, status: ClientStatus, rawQuery: string): Prisma.ClientWhereInput {
  const q = rawQuery.trim().slice(0, 100)
  const where: Prisma.ClientWhereInput = {
    accountId,
    ...(status === 'active' ? { isActive: true } : status === 'archived' ? { isActive: false } : {}),
  }
  if (!q) return where

  const ci = (value: string) => ({ contains: value, mode: 'insensitive' as const })
  const contactOr: Prisma.ClientContactWhereInput[] = [
    { firstName: ci(q) },
    { lastName: ci(q) },
    { email: ci(q) },
  ]
  // "Zachary Gearon": first word against the first name, the rest against the last name.
  const words = q.split(/\s+/)
  if (words.length > 1) {
    contactOr.push({ AND: [{ firstName: ci(words[0]) }, { lastName: ci(words.slice(1).join(' ')) }] })
  }
  return {
    ...where,
    OR: [{ name: ci(q) }, { contacts: { some: { accountId, OR: contactOr } } }],
  }
}

export const CLIENTS_PAGE_SIZE = 100

export function paginate<T>(items: T[], rawPage: string | undefined, size = CLIENTS_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const n = Number.parseInt(rawPage ?? '1', 10)
  const page = Number.isFinite(n) ? Math.min(Math.max(1, n), pages) : 1
  return { items: items.slice((page - 1) * size, page * size), page, pages }
}

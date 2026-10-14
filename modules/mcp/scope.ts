/**
 * Who may read whose time/expenses through the API (specs/22), mapped from the same capability model
 * the UI uses (modules/shared/permissions.ts + lib/timesheetSubject.ts):
 *
 *  - `all`     — account-wide: `view_edit_others_time` unscoped (Admin, Exec Manager, People Admin, or a
 *                per-user grant) or `run_account_reports` (Accounting).
 *  - `managed` — Project Manager: their own rows plus rows on projects they actively manage
 *                (ProjectUserAssignment.isProjectManager), the same scope as mayActForOnProject.
 *  - `self`    — everyone else (Member): only their own rows.
 *
 * Harvest parity: a `self` caller asking for someone else gets `forbidden`; a `managed` caller gets
 * only what they can see plus `scope_limited: true` (empty ≠ "they logged nothing").
 */
import { can, isCapabilityScoped, type Actor } from '@/modules/shared/permissions'
import { forbidden } from './errors'

export type ReadScope = 'all' | 'managed' | 'self'

export function timeReadScope(actor: Actor): ReadScope {
  if (can(actor, 'view_edit_others_time')) return isCapabilityScoped(actor, 'view_edit_others_time') ? 'managed' : 'all'
  if (can(actor, 'run_account_reports')) return 'all'
  return 'self'
}

export interface UserFilter {
  /** Restrict to these users (undefined = everyone the scope allows). */
  userIds?: string[]
  /** Also require: own rows OR rows on a project the caller manages. */
  managedOnly: boolean
  /** True when permissions may have hidden rows the caller asked for. */
  scopeLimited: boolean
}

/** Resolve the requested `user_ids` against the caller's scope (throws `forbidden` for a Member asking about others). */
export function resolveUserFilter(scope: ReadScope, selfId: string, requested?: string[]): UserFilter {
  const want = requested && requested.length ? [...new Set(requested)] : undefined
  if (scope === 'all') return { userIds: want, managedOnly: false, scopeLimited: false }
  if (scope === 'self') {
    if (want && want.some((u) => u !== selfId)) throw forbidden('You can only read your own time and expenses.')
    return { userIds: [selfId], managedOnly: false, scopeLimited: false }
  }
  // managed (Project Manager)
  const onlySelf = !!want && want.every((u) => u === selfId)
  return { userIds: want, managedOnly: !onlySelf, scopeLimited: !onlySelf }
}

/** Write-side: may this actor act on someone else at all (before the per-project check)? */
export function canWriteForOthers(actor: Actor): boolean {
  return can(actor, 'view_edit_others_time')
}

/** Can the caller see billable rates / money on time and projects? */
export function canSeeRates(actor: Actor): boolean {
  return can(actor, 'view_billable_rates')
}

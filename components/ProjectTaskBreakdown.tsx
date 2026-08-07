'use client'

import { useState } from 'react'
import { formatCents } from '@/lib/format'

export type PersonRow = { name: string; minutes: number; billableCents: number; costCents: number }
export type TaskRow = { taskId: string; name: string; minutes: number; billableCents: number; costCents: number; persons: PersonRow[] }

const hrs = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Harvest-style "Billable tasks" breakdown: task → hours / billable amount / cost, each row
 *  expandable to its per-person split. Costs column shown only when the account tracks cost rates. */
export function ProjectTaskBreakdown({ tasks, showCosts }: { tasks: TaskRow[]; showCosts: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const total = tasks.reduce(
    (a, t) => ({ minutes: a.minutes + t.minutes, billableCents: a.billableCents + t.billableCents, costCents: a.costCents + t.costCents }),
    { minutes: 0, billableCents: 0, costCents: 0 },
  )

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-4 py-3 font-medium">Billable tasks</th>
            <th className="px-4 py-3 text-right font-medium">Hours</th>
            <th className="px-4 py-3 text-right font-medium">Billable amount</th>
            {showCosts && <th className="px-4 py-3 text-right font-medium">Costs</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const expandable = t.persons.length > 0
            const isOpen = !!open[t.taskId]
            return (
              <FragmentRow
                key={t.taskId}
                task={t}
                isOpen={isOpen}
                expandable={expandable}
                showCosts={showCosts}
                onToggle={() => setOpen((o) => ({ ...o, [t.taskId]: !o[t.taskId] }))}
              />
            )
          })}
          {tasks.length === 0 && (
            <tr><td colSpan={showCosts ? 4 : 3} className="px-4 py-8 text-center text-gray-400">No time tracked this period.</td></tr>
          )}
        </tbody>
        {tasks.length > 0 && (
          <tfoot>
            <tr className="border-t border-gray-200 font-semibold">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{hrs(total.minutes)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCents(total.billableCents)}</td>
              {showCosts && <td className="px-4 py-3 text-right tabular-nums">{formatCents(total.costCents)}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function FragmentRow({
  task, isOpen, expandable, showCosts, onToggle,
}: {
  task: TaskRow; isOpen: boolean; expandable: boolean; showCosts: boolean; onToggle: () => void
}) {
  return (
    <>
      <tr className={`border-b border-gray-100 ${expandable ? 'cursor-pointer hover:bg-gray-50' : ''}`} onClick={expandable ? onToggle : undefined}>
        <td className="px-4 py-2.5 text-gray-800">
          {expandable && <span className="mr-1.5 inline-block w-3 text-gray-400">{isOpen ? '▾' : '▸'}</span>}
          {!expandable && <span className="mr-1.5 inline-block w-3" />}
          {task.name}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{hrs(task.minutes)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatCents(task.billableCents)}</td>
        {showCosts && <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{formatCents(task.costCents)}</td>}
      </tr>
      {isOpen &&
        task.persons.map((p, i) => (
          <tr key={i} className="border-b border-gray-100 bg-gray-50/60 text-xs">
            <td className="py-1.5 pl-11 pr-4 text-gray-500">{p.name}</td>
            <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{hrs(p.minutes)}</td>
            <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{formatCents(p.billableCents)}</td>
            {showCosts && <td className="px-4 py-1.5 text-right tabular-nums text-gray-400">{formatCents(p.costCents)}</td>}
          </tr>
        ))}
    </>
  )
}

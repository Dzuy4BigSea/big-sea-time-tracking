'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { filterPeople, groupTeammates, timesheetHrefFor, type TeammateOption } from '@/lib/teammates'

/**
 * Harvest's "Teammates" switcher: a button in the top-right of /timesheet that opens a searchable
 * list of people, grouped under Employees then Contractors; picking one opens their timesheet
 * (`?user=<id>`, the current Day/Week view and date kept). Shown only
 * to people with `view_edit_others_time`. It only changes the URL; the page and every server
 * action re-authorize the chosen person.
 */
export function TimesheetPersonSwitcher({
  people,
  selectedId,
  selfId,
  query,
}: {
  people: TeammateOption[]
  selectedId: string
  selfId: string
  /** The view/date/week on screen (without `user`), so switching person keeps it. */
  query: string
}) {
  const router = useRouter()
  const uid = useId()
  const listId = `${uid}-list`
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const [search, setSearch] = useState('')
  const groups = useMemo(() => groupTeammates(filterPeople(people, search)), [people, search])
  // Keyboard order follows the on-screen grouping.
  const filtered = useMemo(() => groups.flatMap((g) => g.people), [groups])

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = (id: string) => {
    close()
    router.push(timesheetHrefFor(query, id, selfId))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % filtered.length : (a - 1 + filtered.length) % filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[active]) choose(filtered[active].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() =>
          open ? close() : (setActive(Math.max(0, groupTeammates(people).flatMap((g) => g.people).findIndex((p) => p.id === selectedId))), setOpen(true))
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Teammates ▾
      </button>
      {open && (
        <div role="dialog" aria-label="Teammates" className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-label="Search teammates"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[active] ? `${uid}-p-${filtered[active].id}` : undefined}
              autoComplete="off"
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-auto py-1 text-sm">
            {filtered.length === 0 && <li className="px-3 py-2 text-gray-400">No teammates found</li>}
            {groups.map((g) => (
              <li key={g.label} role="presentation">
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">{g.label}</div>
                <ul role="group" aria-label={g.label}>
                  {g.people.map((p) => {
                    const i = filtered.indexOf(p)
                    const current = p.id === selectedId
                    return (
                      <li
                        key={p.id}
                        id={`${uid}-p-${p.id}`}
                        role="option"
                        aria-selected={current}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(p.id)}
                        className={`flex cursor-pointer items-center justify-between px-3 py-1.5 ${
                          i === active ? 'bg-brand-teal-50 text-brand-teal' : 'text-gray-800'
                        } ${current ? 'font-medium' : ''}`}
                      >
                        <span className="truncate">
                          {p.name}
                          {p.id === selfId && <span className="font-normal text-gray-400"> (you)</span>}
                        </span>
                        {current && <span aria-hidden className="ml-2 text-brand-teal">✓</span>}
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

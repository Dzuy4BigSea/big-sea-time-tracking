'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterOptions, groupOptions, type ComboOption } from '@/lib/combobox'

/**
 * Multi-select type-ahead (Harvest's report filter pickers: "All clients", "Everyone"). Chosen items
 * show as removable chips; type to filter (same matching as Combobox), ↑/↓ + Enter to add, Backspace
 * on an empty box removes the last chip. Posts the chosen values comma-joined in a hidden input `name`.
 */
export function MultiCombobox({
  name,
  options,
  defaultValue = [],
  placeholder = 'All',
  emptyText = 'No matches',
  'aria-label': ariaLabel,
}: {
  name: string
  options: ComboOption[]
  defaultValue?: string[]
  placeholder?: string
  emptyText?: string
  'aria-label'?: string
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const optId = (i: number) => `${uid}-opt-${i}`
  const inputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<string[]>(defaultValue)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
  const remaining = useMemo(() => options.filter((o) => !values.includes(o.value)), [options, values])
  const sections = useMemo(() => groupOptions(filterOptions(remaining, query)), [remaining, query])
  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections])

  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  const add = (o: ComboOption) => {
    setValues((v) => [...v, o.value])
    setQuery('')
    setActive(0)
  }
  const remove = (value: string) => setValues((v) => v.filter((x) => x !== value))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (flat.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % flat.length : (a - 1 + flat.length) % flat.length))
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault()
        if (flat[active]) add(flat[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setQuery('')
      }
    } else if (e.key === 'Backspace' && query === '' && values.length) {
      remove(values[values.length - 1])
    }
  }

  let idx = -1
  return (
    <div className="relative">
      <div
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault()
          inputRef.current?.focus()
          setOpen(true)
        }}
        className="flex min-h-[34px] w-full cursor-text flex-wrap items-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-1 text-sm focus-within:border-brand-teal"
      >
        {values.map((v) => (
          <span key={v} className="flex max-w-full items-center gap-1 rounded bg-gray-100 py-0.5 pl-2 pr-1 text-gray-800">
            <span className="truncate">{byValue.get(v)?.label ?? 'Unknown'}</span>
            <button
              type="button"
              aria-label={`Remove ${byValue.get(v)?.label ?? 'item'}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(v)}
              className="rounded px-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? optId(active) : undefined}
          autoComplete="off"
          value={query}
          placeholder={values.length ? '' : placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none focus:ring-0"
        />
      </div>
      <input type="hidden" name={name} value={values.join(',')} />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 z-30 mt-1 max-h-72 w-full overflow-auto rounded border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {flat.length === 0 && <li className="px-3 py-2 text-gray-400">{emptyText}</li>}
          {sections.map((s) => (
            <li key={s.group ?? '__none'} role="presentation">
              {s.group && <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.group}</div>}
              <ul role="group" aria-label={s.group ?? undefined}>
                {s.options.map((o) => {
                  idx += 1
                  const i = idx
                  return (
                    <li
                      key={o.value}
                      id={optId(i)}
                      role="option"
                      aria-selected={false}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(o)}
                      className={`cursor-pointer py-1.5 pr-3 ${s.group ? 'pl-5' : 'pl-3'} ${i === active ? 'bg-brand-teal-50 text-brand-teal' : 'text-gray-800'}`}
                    >
                      {o.label}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

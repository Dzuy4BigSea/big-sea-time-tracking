'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterOptions, groupOptions, type ComboOption } from '@/lib/combobox'

export type { ComboOption }

/**
 * Type-to-filter select (Harvest-style): focus or type to open the list, every typed word narrows
 * it (matching the label, the section/group and hidden keywords), ↑/↓ + Enter to pick, Esc to close.
 * Options with a `group` render under a section heading (e.g. projects under their client).
 *
 * Drop-in for a native <select> inside a form: the chosen value is posted through a hidden input
 * named `name`, so server actions don't change. `required` blocks submit until something is picked.
 */
export function Combobox({
  name,
  options,
  defaultValue = '',
  placeholder = 'Select…',
  required,
  disabled,
  className = '',
  emptyText = 'No matches',
  onValueChange,
  'aria-label': ariaLabel,
}: {
  name: string
  options: ComboOption[]
  defaultValue?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  /** Width/layout classes for the wrapper (e.g. `w-64`). */
  className?: string
  emptyText?: string
  onValueChange?: (value: string) => void
  'aria-label'?: string
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const optId = (i: number) => `${uid}-opt-${i}`
  const inputRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState(defaultValue)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selected = options.find((o) => o.value === value) ?? null
  const filtered = useMemo(() => filterOptions(options, query), [options, query])
  const sections = useMemo(() => groupOptions(filtered), [filtered])
  // Flat order as rendered (sections can regroup options), so ↑/↓ follow what's on screen.
  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections])

  // Native-validation hook: an empty required combobox blocks submit like an empty <select required>.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? 'Please choose an option from the list.' : '')
  }, [required, value])

  // Honor <form>.reset().
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const onReset = () => {
      setValue(defaultValue)
      setQuery('')
      setOpen(false)
    }
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [defaultValue])

  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openList = () => {
    if (open) return
    const i = flat.findIndex((o) => o.value === value)
    setActive(i >= 0 ? i : 0)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const choose = (o: ComboOption) => {
    setValue(o.value)
    onValueChange?.(o.value)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openList()
      if (flat.length === 0) return
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % flat.length : (a - 1 + flat.length) % flat.length))
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault() // pick, don't submit the form
        if (flat[active]) choose(flat[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
    } else if (e.key === 'Tab') {
      if (open) close()
    }
  }

  let idx = -1
  return (
    <div className={`relative ${className}`}>
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
        disabled={disabled}
        // While open the box is the search field; the current choice shows as its placeholder.
        value={open ? query : (selected?.label ?? '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={openList}
        onMouseDown={() => (open ? close() : openList())}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded border border-gray-300 py-1.5 pl-2 pr-6 text-sm disabled:bg-gray-50 disabled:text-gray-400"
      />
      <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">▼</span>
      <input type="hidden" name={name} value={value} disabled={disabled} />
      {open && (
        <ul
          id={listId}
          role="listbox"
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 z-30 mt-1 max-h-72 w-max min-w-full max-w-[28rem] overflow-auto rounded border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {flat.length === 0 && <li className="px-3 py-2 text-gray-400">{emptyText}</li>}
          {sections.map((s) => (
            <li key={s.group ?? '__none'} role="presentation">
              {s.group && (
                <div role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {s.group}
                </div>
              )}
              <ul role="group" aria-label={s.group ?? undefined}>
                {s.options.map((o) => {
                  idx += 1
                  const i = idx
                  return (
                    <li
                      key={o.value}
                      id={optId(i)}
                      role="option"
                      aria-selected={o.value === value}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(o)}
                      className={`cursor-pointer py-1.5 pr-3 ${s.group ? 'pl-5' : 'pl-3'} ${i === active ? 'bg-brand-teal-50 text-brand-teal' : 'text-gray-800'} ${
                        o.value === value ? 'font-medium' : ''
                      }`}
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

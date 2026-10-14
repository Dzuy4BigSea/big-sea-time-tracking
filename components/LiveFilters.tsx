'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * URL-driven filter controls that apply as soon as they change — no "Apply" button. Each control
 * owns one query param; the rest of the query string is preserved. Empty values drop the param.
 * Text input is debounced so typing doesn't navigate on every keystroke.
 */
function useSetParam(param: string, resetParams: string[] = []) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const set = (value: string) => {
    // Read the live URL (not the render-time snapshot) so a debounced update can't undo a newer one.
    const p = new URLSearchParams(window.location.search)
    if (value) p.set(param, value)
    else p.delete(param)
    for (const r of resetParams) p.delete(r)
    const s = p.toString()
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }))
  }
  return { current: searchParams.get(param) ?? '', set, pending }
}

export function LiveSearchInput({
  param,
  placeholder,
  className = '',
  delayMs = 300,
  activeClassName,
  clearLabel,
  resetParams,
}: {
  param: string
  placeholder?: string
  className?: string
  delayMs?: number
  /** Extra classes while a term is entered (e.g. a tinted background). */
  activeClassName?: string
  /** When set, a button with this label appears beside the input while a term is entered. */
  clearLabel?: string
  /** Other params dropped whenever the term changes (e.g. "page"). */
  resetParams?: string[]
}) {
  const { current, set } = useSetParam(param, resetParams)
  const [value, setValue] = useState(current)
  const lastSent = useRef(current)

  // Keep the box in sync when the URL changes from elsewhere (e.g. a "Clear" link).
  useEffect(() => {
    if (current !== lastSent.current) {
      lastSent.current = current
      setValue(current)
    }
  }, [current])

  useEffect(() => {
    const term = value.trim()
    if (term === lastSent.current) return
    const id = setTimeout(() => {
      lastSent.current = term
      set(term)
    }, delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  const active = value.trim() !== ''
  const input = (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={active && activeClassName ? `${className} ${activeClassName}` : className}
    />
  )
  if (!clearLabel) return input

  return (
    <span className="inline-flex items-center gap-2">
      {input}
      {(active || current) && (
        <button
          type="button"
          onClick={() => {
            setValue('')
            lastSent.current = ''
            set('')
          }}
          className="whitespace-nowrap text-sm text-gray-500 hover:text-gray-800"
        >
          ✕ {clearLabel}
        </button>
      )}
    </span>
  )
}

export function LiveSelect({
  param,
  options,
  className = '',
}: {
  param: string
  /** Options with a `group` render under an <optgroup> of that name (consecutive runs), others ungrouped. */
  options: { value: string; label: string; group?: string }[]
  className?: string
}) {
  const { current, set } = useSetParam(param)
  const runs: { group?: string; options: { value: string; label: string }[] }[] = []
  for (const o of options) {
    const last = runs[runs.length - 1]
    if (last && last.group === o.group) last.options.push(o)
    else runs.push({ group: o.group, options: [o] })
  }
  const opt = (o: { value: string; label: string }) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  )
  return (
    <select value={current} onChange={(e) => set(e.target.value)} className={className}>
      {runs.map((r, i) =>
        r.group ? (
          <optgroup key={`${r.group}-${i}`} label={r.group}>
            {r.options.map(opt)}
          </optgroup>
        ) : (
          r.options.map(opt)
        ),
      )}
    </select>
  )
}

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * URL-driven filter controls that apply as soon as they change — no "Apply" button. Each control
 * owns one query param; the rest of the query string is preserved. Empty values drop the param.
 * Text input is debounced so typing doesn't navigate on every keystroke.
 */
function useSetParam(param: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const set = (value: string) => {
    // Read the live URL (not the render-time snapshot) so a debounced update can't undo a newer one.
    const p = new URLSearchParams(window.location.search)
    if (value) p.set(param, value)
    else p.delete(param)
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
}: {
  param: string
  placeholder?: string
  className?: string
  delayMs?: number
}) {
  const { current, set } = useSetParam(param)
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

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}

export function LiveSelect({
  param,
  options,
  className = '',
}: {
  param: string
  options: { value: string; label: string }[]
  className?: string
}) {
  const { current, set } = useSetParam(param)
  return (
    <select value={current} onChange={(e) => set(e.target.value)} className={className}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

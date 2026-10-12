'use client'

import { useEffect, useRef } from 'react'

/**
 * A <details>-based dropdown menu that behaves like a menu: opening one closes any other open
 * dropdown, and clicking outside or pressing Escape closes it. Works without JS as a plain
 * <details> disclosure.
 */
export function DropdownMenu({
  label,
  children,
  className = 'relative inline-block text-left',
  summaryClassName = 'cursor-pointer list-none rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50',
  menuClassName = 'absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg',
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
  summaryClassName?: string
  menuClassName?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onPointerDown = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.open) {
        el.open = false
        el.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <details
      ref={ref}
      data-dropdown-menu=""
      className={className}
      onToggle={(e) => {
        const self = e.currentTarget
        if (!self.open) return
        // Single-open: close every other dropdown menu on the page.
        document.querySelectorAll<HTMLDetailsElement>('details[data-dropdown-menu][open]').forEach((d) => {
          if (d !== self) d.open = false
        })
      }}
    >
      <summary className={summaryClassName}>{label}</summary>
      <div
        className={menuClassName}
        onClick={(e) => {
          // Close after choosing an item (links navigate client-side and the menu would otherwise stay open).
          if ((e.target as HTMLElement).closest('a,button')) ref.current?.removeAttribute('open')
        }}
      >
        {children}
      </div>
    </details>
  )
}

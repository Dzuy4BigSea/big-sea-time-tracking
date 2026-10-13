'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { buildHref } from '@/modules/shared/timeframe'

/**
 * Middle of the report period stepper (Harvest): calendar icon + "This week 12 – 18 Oct 2026".
 * Clicking opens the native date picker; picking a day jumps to the period containing it.
 */
export function PeriodJumpButton({
  basePath,
  params,
  anchor,
  prefix,
  range,
}: {
  basePath: string
  /** Every param except `anchor` (period, tab, sort, …). */
  params: Record<string, string | null | undefined>
  anchor: string
  prefix: string | null
  range: string
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)

  return (
    <span className="relative flex">
      <button
        type="button"
        onClick={() => {
          const el = input.current
          if (!el) return
          try {
            el.showPicker()
          } catch {
            el.focus()
          }
        }}
        title="Jump to a date"
        className="flex items-center gap-2 whitespace-nowrap px-3 py-1.5 text-gray-800 hover:bg-gray-50"
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {prefix && <span className="font-semibold">{prefix}</span>}
        <span>{range}</span>
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-label="Jump to date"
        defaultValue={anchor}
        onChange={(e) => {
          if (e.target.value) router.push(buildHref(basePath, { ...params, anchor: e.target.value }), { scroll: false })
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-full opacity-0"
      />
    </span>
  )
}

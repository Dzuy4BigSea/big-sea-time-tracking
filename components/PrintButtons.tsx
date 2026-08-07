'use client'

import { useEffect } from 'react'

/** Triggers the browser print dialog on mount (used by the dedicated print view). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 450) // let fonts + logo settle first
    return () => clearTimeout(t)
  }, [])
  return null
}

/** A Print / Save-as-PDF button (browsers' print dialog offers "Save as PDF"). */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Print / PDF
    </button>
  )
}

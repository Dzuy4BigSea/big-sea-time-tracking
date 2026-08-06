'use client'

import { useState } from 'react'
import { TimeEntryModal, type TimeEntryProject } from '@/components/TimeEntryModal'

/** A button that opens the shared "New time entry" dialog. Used where time tracking appears. */
export function TimeEntryButton({
  projects,
  defaultDate,
  label = 'New time entry',
}: {
  projects: TimeEntryProject[]
  defaultDate: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        + {label}
      </button>
      <TimeEntryModal open={open} onClose={() => setOpen(false)} projects={projects} defaultDate={defaultDate} />
    </>
  )
}

'use client'

import { useState } from 'react'
import { TimeEntryModal, type TimeEntryProject } from '@/components/TimeEntryModal'
import { todayYmdIn } from '@/lib/tz'

/** A button that opens the shared "New time entry" dialog. Used where time tracking appears. */
export function TimeEntryButton({
  projects,
  defaultDate,
  label = 'New time entry',
  forUser,
  timezone,
  followToday = false,
}: {
  projects: TimeEntryProject[]
  defaultDate: string
  label?: string
  /** Set when the timesheet is showing someone else (person switcher). */
  forUser?: { id: string; name: string }
  /** Account timezone; with `followToday`, the dialog opens on the account's today at click time. */
  timezone?: string
  /**
   * The page was showing "today": default to the account's today when the dialog opens, so a tab
   * left open past midnight doesn't log onto yesterday.
   */
  followToday?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(defaultDate)
  return (
    <>
      <button
        onClick={() => {
          setDate(followToday && timezone ? todayYmdIn(timezone) : defaultDate)
          setOpen(true)
        }}
        className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        + {label}
      </button>
      <TimeEntryModal open={open} onClose={() => setOpen(false)} projects={projects} defaultDate={date} forUser={forUser} />
    </>
  )
}

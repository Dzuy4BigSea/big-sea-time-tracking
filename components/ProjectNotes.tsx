'use client'

import { useState } from 'react'

/** Project notes on the analysis page header: two faded lines with a "Show more" / "Show less" toggle (Harvest). */
export function ProjectNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false)
  // Only offer the toggle when the notes can overflow two lines.
  const long = notes.length > 160 || notes.split('\n').length > 2
  return (
    <div className="mt-2 max-w-3xl text-sm text-gray-500">
      <p className={`whitespace-pre-line ${open || !long ? '' : 'line-clamp-2'}`}>{notes}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-xs text-brand-teal hover:underline">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

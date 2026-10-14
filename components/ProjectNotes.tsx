'use client'

import { useState } from 'react'

/**
 * Project notes on the analysis page header: two faded lines with a "Show more" / "Show less" toggle
 * (Harvest). `html` is already sanitized on the server (modules/projects/notes.ts); `text` is its
 * visible text, used to decide whether the notes can overflow two lines.
 */
export function ProjectNotes({ html, text }: { html: string; text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 160 || text.split('\n').length > 2
  return (
    <div className="mt-2 max-w-3xl text-sm text-gray-500">
      <div
        className={`rich-text ${open || !long ? '' : 'max-h-10 overflow-hidden'}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-xs text-brand-teal hover:underline">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

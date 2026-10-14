'use client'

import { useState } from 'react'

/**
 * Harvest "Copy invoice link": copies the public client link (/i/<token>) to the clipboard and
 * briefly shows "Copied!". Falls back to a prompt when the Clipboard API is unavailable.
 */
export function CopyInvoiceLinkButton({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const url = new URL(path, window.location.origin).toString()
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('Copy the invoice link:', url)
        }
      }}
    >
      <span aria-live="polite">{copied ? 'Copied!' : 'Copy invoice link'}</span>
    </button>
  )
}

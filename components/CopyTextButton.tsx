'use client'

import { useState } from 'react'

/** Small "copy" affordance for an id shown truncated (trace external ids). */
export function CopyTextButton({ text, label, title }: { text: string; label: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={title ?? text}
      className="rounded px-1 font-mono text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          window.prompt('Copy:', text)
        }
      }}
    >
      <span aria-live="polite">{copied ? 'Copied!' : label}</span>
    </button>
  )
}

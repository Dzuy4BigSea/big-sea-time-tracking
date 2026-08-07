'use client'

import { useRouter } from 'next/navigation'

/**
 * A table row that navigates to `href` when clicked anywhere — except on an explicit interactive
 * element (link, button, input, select, label), which keeps its own behavior. Mirrors Harvest, where
 * the whole row is clickable but an inner link like "Hours" supersedes it.
 */
export function ClickableRow({
  href,
  children,
  className = '',
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  return (
    <tr
      className={`cursor-pointer ${className}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,input,select,label,summary')) return
        router.push(href)
      }}
    >
      {children}
    </tr>
  )
}

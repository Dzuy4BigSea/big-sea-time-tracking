'use client'

import { useEffect } from 'react'

const MESSAGE = 'You have unsaved changes. Leave this page anyway?'

/**
 * Harvest-style leave-page guard for a dirty form: the browser's native prompt on reload/close
 * (beforeunload), plus a confirm() before in-app link navigation (the App Router has no
 * route-change event, so same-tab <a> clicks are intercepted in the capture phase).
 */
export function useLeavePageGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // required by some browsers to show the prompt
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return // full navigation → beforeunload handles it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return // in-page anchor
      if (!window.confirm(MESSAGE)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])
}

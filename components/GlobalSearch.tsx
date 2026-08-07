'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchHit } from '@/app/api/search/route'

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  invoice: 'Invoices',
  project: 'Projects',
  client: 'Clients',
  task: 'Tasks',
  person: 'People',
}
const GROUP_ORDER: SearchHit['type'][] = ['invoice', 'project', 'client', 'task', 'person']

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function GlobalSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // Debounced fetch.
  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const id = setTimeout(async () => {
      const mine = ++seq.current
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`)
        const data = await res.json()
        if (mine === seq.current) {
          setHits(data.hits ?? [])
          setActive(0)
        }
      } catch {
        if (mine === seq.current) setHits([])
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 180)
    return () => clearTimeout(id)
  }, [q])

  // Cmd/Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Outside click closes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false)
      setQ('')
      setHits([])
      router.push(hit.href)
    },
    [router],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showPanel = open && q.trim().length > 0

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-500 focus-within:border-brand-teal">
        <IconSearch />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search invoices, projects, clients, people…"
          className="w-full bg-transparent text-gray-800 outline-none placeholder:text-gray-400"
          aria-label="Global search"
          autoComplete="off"
        />
        <kbd className="hidden rounded border border-gray-200 px-1 text-[10px] text-gray-400 sm:inline">⌘K</kbd>
      </div>

      {showPanel && (
        <div className="absolute left-0 z-40 mt-1 max-h-[70vh] w-[26rem] max-w-[90vw] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {loading && hits.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && hits.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No matches for “{q.trim()}”.</div>}
          {GROUP_ORDER.map((type) => {
            const group = hits.filter((h) => h.type === type)
            if (!group.length) return null
            return (
              <div key={type}>
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{TYPE_LABEL[type]}</div>
                {group.map((hit) => {
                  const idx = hits.indexOf(hit)
                  return (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        go(hit)
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                        idx === active ? 'bg-brand-teal-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-gray-800">{hit.title}</span>
                        {hit.subtitle && <span className="block truncate text-xs text-gray-400">{hit.subtitle}</span>}
                      </span>
                      {hit.badge && <span className="shrink-0 text-xs capitalize text-gray-400">{hit.badge}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

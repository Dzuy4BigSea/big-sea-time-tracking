/** Pure helpers for the type-to-filter `Combobox` (components/Combobox.tsx). */

export type ComboOption = {
  value: string
  label: string
  /** Section heading (e.g. the client a project belongs to). Options sharing a group render together. */
  group?: string
  /** Extra searchable text that isn't shown (e.g. a project code). */
  keywords?: string
}

export type ComboSection = { group: string | null; options: ComboOption[] }

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Harvest-style filter: every whitespace-separated term must appear (case/accent-insensitive)
 * somewhere in the option's label, group or keywords. So "acme web" finds Acme Co → Website.
 */
export function filterOptions(options: readonly ComboOption[], query: string): ComboOption[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...options]
  return options.filter((o) => {
    const hay = norm(`${o.label} ${o.group ?? ''} ${o.keywords ?? ''}`)
    return terms.every((t) => hay.includes(t))
  })
}

/** Group options into sections, preserving first-seen group order and option order within a group. */
export function groupOptions(options: readonly ComboOption[]): ComboSection[] {
  const sections: ComboSection[] = []
  const byGroup = new Map<string | null, ComboSection>()
  for (const o of options) {
    const g = o.group ?? null
    let s = byGroup.get(g)
    if (!s) {
      s = { group: g, options: [] }
      byGroup.set(g, s)
      sections.push(s)
    }
    s.options.push(o)
  }
  return sections
}

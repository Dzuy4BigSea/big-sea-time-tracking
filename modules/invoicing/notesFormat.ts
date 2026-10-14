/**
 * Harvest's invoice-notes formatting ("Formatting tips: *bold* _italics_"). Pure tokenizer: the
 * views render the segments as React elements, so no HTML is ever injected.
 *
 * A marker only counts at a word boundary, so snake_case_names and 2*3*4 stay as typed.
 */
export interface NoteSegment {
  text: string
  bold?: boolean
  italic?: boolean
}

const MARKUP = /(^|[^\w*])(\*(?!\s)([^*\n]+?)(?<!\s)\*|_(?!\s)([^_\n]+?)(?<!\s)_)(?!\w)/g

export function formatNotes(src: string): NoteSegment[] {
  const out: NoteSegment[] = []
  let last = 0
  for (const m of src.matchAll(MARKUP)) {
    const start = (m.index ?? 0) + m[1].length
    if (start > last) out.push({ text: src.slice(last, start) })
    if (m[3] != null) out.push({ text: m[3], bold: true })
    else out.push({ text: m[4], italic: true })
    last = start + m[2].length
  }
  if (last < src.length) out.push({ text: src.slice(last) })
  return out
}

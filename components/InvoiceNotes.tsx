import { formatNotes } from '@/modules/invoicing/notesFormat'

/** Invoice notes with Harvest's *bold* / _italics_ formatting, rendered as elements (no raw HTML). */
export function InvoiceNotesText({ text }: { text: string }) {
  return (
    <>
      {formatNotes(text).map((s, i) =>
        s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : <span key={i}>{s.text}</span>,
      )}
    </>
  )
}

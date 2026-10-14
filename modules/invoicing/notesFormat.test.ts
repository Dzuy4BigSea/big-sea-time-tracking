import { describe, it, expect } from 'vitest'
import { formatNotes } from './notesFormat'

describe('formatNotes (Harvest *bold* _italics_)', () => {
  it('plain text is one segment', () => {
    expect(formatNotes('Thanks for your business.')).toEqual([{ text: 'Thanks for your business.' }])
  })
  it('bold and italics', () => {
    expect(formatNotes('Pay *within 30 days* via _ACH_.')).toEqual([
      { text: 'Pay ' },
      { text: 'within 30 days', bold: true },
      { text: ' via ' },
      { text: 'ACH', italic: true },
      { text: '.' },
    ])
  })
  it('leaves snake_case, arithmetic and unmatched markers alone', () => {
    expect(formatNotes('see file_name_here')).toEqual([{ text: 'see file_name_here' }])
    expect(formatNotes('2*3*4')).toEqual([{ text: '2*3*4' }])
    expect(formatNotes('a * b')).toEqual([{ text: 'a * b' }])
  })
  it('does not span lines', () => {
    expect(formatNotes('*a\nb*')).toEqual([{ text: '*a\nb*' }])
  })
  it('works at the start of the text', () => {
    expect(formatNotes('*Note:* hi')).toEqual([{ text: 'Note:', bold: true }, { text: ' hi' }])
  })
})

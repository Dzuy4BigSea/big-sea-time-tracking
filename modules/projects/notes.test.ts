import { describe, expect, it } from 'vitest'
import { isRichNotes, normalizeProjectNotes, plainTextToHtml, projectNotesHtml, projectNotesText, PROJECT_NOTES_MAX_LENGTH } from './notes'

const HARVEST_NOTES = 'CORDELIA LABS PROJECT\nDEPARTMENT: MEDIA & SEO\n\nUp to 5 Hours/mo for:\n• Account Clean-Up\n• Analytics Tracking'

describe('project notes (AC-PROJ-012–014)', () => {
  it('AC-PROJ-013: Harvest plain-text notes render as paragraphs with line breaks, escaped', () => {
    expect(projectNotesHtml(HARVEST_NOTES)).toBe(
      '<p>CORDELIA LABS PROJECT<br>DEPARTMENT: MEDIA &amp; SEO</p><p>Up to 5 Hours/mo for:<br>• Account Clean-Up<br>• Analytics Tracking</p>',
    )
    expect(projectNotesHtml('Use <b> tags & "quotes"')).toBe('<p>Use &lt;b&gt; tags &amp; &quot;quotes&quot;</p>')
    expect(plainTextToHtml('a\r\n\r\n\r\nb')).toBe('<p>a</p><p>b</p>')
  })

  it('AC-PROJ-013: empty notes render nothing', () => {
    expect(projectNotesHtml(null)).toBe('')
    expect(projectNotesHtml('   \n ')).toBe('')
  })

  it('AC-PROJ-012: editor formatting is kept (bold, italic, underline, lists, links)', () => {
    const html = '<p><strong>Scope</strong> <em>monthly</em> <u>only</u></p><ul><li><p>Clean-up</p></li></ul><ol><li><p>Launch</p></li></ol>'
    expect(normalizeProjectNotes(html)).toEqual({ notes: html })
    expect(projectNotesHtml('<p><a href="https://bigsea.co">site</a></p>')).toBe(
      '<p><a href="https://bigsea.co" target="_blank" rel="noopener noreferrer nofollow">site</a></p>',
    )
  })

  it('AC-PROJ-014: scripts, event handlers, styles and javascript: links are stripped', () => {
    const evil =
      '<p onclick="alert(1)" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>' +
      '<p><a href="javascript:alert(1)">x</a><a href="//evil.example">y</a><iframe src="https://evil.example"></iframe></p>'
    const out = projectNotesHtml(evil)
    expect(out).toBe('<p>Hi</p><p><a target="_blank" rel="noopener noreferrer nofollow">x</a><a target="_blank" rel="noopener noreferrer nofollow">y</a></p>')
    expect(normalizeProjectNotes(evil)).toEqual({ notes: out })
  })

  it('AC-PROJ-014: input that is not editor HTML is stored as escaped plain text', () => {
    expect(normalizeProjectNotes('<script>alert(1)</script>')).toEqual({ notes: '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>' })
    expect(isRichNotes('<p>x</p>')).toBe(true)
    expect(isRichNotes('<script>x</script>')).toBe(false)
    expect(isRichNotes('Plain <b>')).toBe(false)
  })

  it('AC-PROJ-012: clearing the editor clears the notes', () => {
    expect(normalizeProjectNotes('')).toEqual({ notes: null })
    expect(normalizeProjectNotes('<p></p>')).toEqual({ notes: null })
    expect(normalizeProjectNotes('<p><br></p><ul><li><p></p></li></ul>')).toEqual({ notes: null })
    expect(normalizeProjectNotes(null)).toEqual({ notes: null })
  })

  it('rejects notes over the length cap', () => {
    const big = `<p>${'x'.repeat(PROJECT_NOTES_MAX_LENGTH)}</p>`
    expect(normalizeProjectNotes(big)).toEqual({ error: 'Notes are too long.' })
  })

  it('visible text drops tags and keeps line structure', () => {
    expect(projectNotesText('<p>One &amp; <strong>two</strong></p><ul><li><p>three</p></li></ul>')).toBe('One & two\nthree')
    expect(projectNotesText(HARVEST_NOTES)).toBe(HARVEST_NOTES)
    expect(projectNotesText(null)).toBe('')
  })
})

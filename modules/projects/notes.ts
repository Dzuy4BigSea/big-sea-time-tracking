/**
 * Project notes (specs/03 §Projects, AC-PROJ-012–014; BugHerd #24).
 *
 * Notes are rich text: the editor stores a small HTML subset. Notes imported from Harvest are plain
 * text, so every read goes through `projectNotesHtml`, which escapes plain text and sanitizes HTML
 * against an allowlist. Writes go through `normalizeProjectNotes`. Server-only (sanitize-html).
 */
import sanitizeHtml from 'sanitize-html'

/** Generous cap on stored notes (HTML), so a paste can't bloat a project row. */
export const PROJECT_NOTES_MAX_LENGTH = 50_000

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
  // target/rel are always overwritten by transformTags below (which runs before this filter).
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Links open in a new tab and don't leak the app page to the target.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
}

/** Does the stored value come from the rich-text editor (HTML) rather than Harvest (plain text)? */
export function isRichNotes(raw: string): boolean {
  return /^\s*<(p|ul|ol|h[1-6]|blockquote)[\s>]/i.test(raw)
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Plain text → paragraphs: blank lines split paragraphs, single newlines become <br>. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((para) => para.replace(/^\n+|\n+$/g, ''))
    .filter((para) => para.trim() !== '')
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Safe HTML for display or for loading into the editor; '' when there are no notes. */
export function projectNotesHtml(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return ''
  return isRichNotes(raw) ? sanitizeHtml(raw, SANITIZE) : plainTextToHtml(raw)
}

/** The notes' visible text (no tags), e.g. to decide whether a "Show more" toggle is needed. */
export function projectNotesText(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!isRichNotes(raw)) return raw.trim()
  const withBreaks = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h[1-6]|blockquote)>/gi, '\n')
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Editor HTML from a form → the value to store: sanitized HTML, or null when the editor is empty
 * (e.g. "<p></p>"). Returns an error for notes over the length cap.
 */
export function normalizeProjectNotes(input: string | null | undefined): { notes: string | null } | { error: string } {
  const raw = (input ?? '').trim()
  if (!raw) return { notes: null }
  // Anything not from the editor is treated as plain text, so it can't smuggle markup in.
  const html = isRichNotes(raw) ? sanitizeHtml(raw, SANITIZE) : plainTextToHtml(raw)
  if (!projectNotesText(html)) return { notes: null }
  if (html.length > PROJECT_NOTES_MAX_LENGTH) return { error: 'Notes are too long.' }
  return { notes: html }
}

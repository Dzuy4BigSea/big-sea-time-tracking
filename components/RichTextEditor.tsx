'use client'

import { useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'

/**
 * Rich-text field for forms (project notes, specs/03 AC-PROJ-012): bold, italic, underline, lists
 * and links. The HTML goes out through a hidden input named `name`; the server sanitizes it
 * (modules/projects/notes.ts), so this editor is never the only guard.
 */
export function RichTextEditor({
  name,
  initialHtml,
  onChange,
  label,
}: {
  name: string
  initialHtml: string
  onChange?: () => void
  label?: string
}) {
  const [html, setHtml] = useState(initialHtml)
  const editor = useEditor({
    // Render on the client only (avoids a hydration mismatch under the App Router).
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, code: false, codeBlock: false, horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, protocols: ['mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow' } }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: 'rich-text min-h-[10rem] max-h-[32rem] overflow-y-auto px-3 py-2 text-sm text-gray-900 focus:outline-none',
        ...(label ? { 'aria-label': label } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.isEmpty ? '' : editor.getHTML())
      onChange?.()
    },
  })

  return (
    <div className="rounded border border-gray-300 bg-white focus-within:border-gray-400">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={html} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const btn = (active: boolean) =>
    `flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm ${active ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor)

  const setLink = (e: Editor) => {
    const prev = (e.getAttributes('link').href as string | undefined) ?? ''
    const raw = window.prompt('Link URL (leave empty to remove the link)', prev)
    if (raw === null) return
    const url = raw.trim()
    if (!url) {
      e.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`
    e.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const items: { label: string; title: string; active: (e: Editor) => boolean; action: (e: Editor) => void; className?: string }[] = [
    { label: 'B', title: 'Bold', active: (e) => e.isActive('bold'), action: (e) => e.chain().focus().toggleBold().run(), className: 'font-bold' },
    { label: 'I', title: 'Italic', active: (e) => e.isActive('italic'), action: (e) => e.chain().focus().toggleItalic().run(), className: 'italic' },
    { label: 'U', title: 'Underline', active: (e) => e.isActive('underline'), action: (e) => e.chain().focus().toggleUnderline().run(), className: 'underline' },
    { label: '•', title: 'Bulleted list', active: (e) => e.isActive('bulletList'), action: (e) => e.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Numbered list', active: (e) => e.isActive('orderedList'), action: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: '🔗', title: 'Link', active: (e) => e.isActive('link'), action: setLink },
  ]

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-1.5 py-1" role="toolbar" aria-label="Formatting">
      {items.map((it) => (
        <button
          key={it.title}
          type="button"
          title={it.title}
          aria-label={it.title}
          aria-pressed={editor ? it.active(editor) : false}
          disabled={!editor}
          onMouseDown={(ev) => ev.preventDefault()} // keep the editor's selection
          onClick={run(it.action)}
          className={`${btn(editor ? it.active(editor) : false)} ${it.className ?? ''} disabled:opacity-50`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

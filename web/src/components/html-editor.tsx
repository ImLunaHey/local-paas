import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- The entire editor module is loaded through React.lazy in waking-page.tsx.
import { EditorView } from '@codemirror/view'
// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- These dependencies stay inside the lazily loaded editor chunk.
import { Compartment, EditorState } from '@codemirror/state'
import { html } from '@codemirror/lang-html'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': {
    height: '480px',
    fontSize: '12px',
    backgroundColor: 'light-dark(#fafafa, #0b0b0d)',
    color: 'light-dark(#27272a, #e4e4e7)',
  },
  '&.cm-focused': { outline: '2px solid var(--color-accent)', outlineOffset: '-2px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.7' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--color-accent)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': {
    backgroundColor: 'light-dark(#f4f4f5, #131315)',
    color: 'var(--color-muted)',
    borderColor: 'var(--color-line)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'light-dark(#ff8a4c12, #ff8a4c0c)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#ff8a4c30',
  },
  '.cm-tooltip, .cm-panels': {
    backgroundColor: 'light-dark(#f4f4f5, #18181b)',
    color: 'light-dark(#27272a, #e4e4e7)',
    borderColor: 'var(--color-line)',
  },
  '.cm-searchMatch': { backgroundColor: '#ff8a4c30', outline: '1px solid var(--color-accent)' },
  '.cm-button, .cm-textfield': {
    background: 'light-dark(#fafafa, #27272a)',
    color: 'inherit',
    border: '1px solid var(--color-line)',
    borderRadius: '4px',
  },
})
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.tagName, tags.keyword], color: 'light-dark(#9a3412, #ff9a62)' },
    { tag: [tags.attributeName, tags.propertyName], color: 'light-dark(#7c3aed, #c4b5fd)' },
    { tag: [tags.string, tags.attributeValue], color: 'light-dark(#065f46, #9bd2a8)' },
    { tag: [tags.number, tags.bool], color: 'light-dark(#92400e, #fcd34d)' },
    { tag: tags.comment, color: 'var(--color-muted)', fontStyle: 'italic' },
  ]),
)

export function HtmlEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const initialValue = useRef(value)
  const [editable] = useState(() => new Compartment())
  useEffect(() => {
    if (!parent.current) return
    const editor = new EditorView({
      parent: parent.current,
      doc: initialValue.current,
      extensions: [
        basicSetup,
        html(),
        theme,
        highlighting,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'Waking page HTML',
          'aria-describedby': 'waking-editor-help',
        }),
        editable.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
      ],
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [onChange, editable])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }
  }, [value])
  useEffect(() => {
    view.current?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(disabled)) })
  }, [disabled, editable])
  return <div ref={parent} className="min-w-0 overflow-hidden" />
}

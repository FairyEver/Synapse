// @vitest-environment jsdom

import {
  exportLexicalTreeToMdast,
  lexical,
  MDXEditor,
  type MDXEditorMethods,
  tablePlugin,
} from '@mdxeditor/editor'
import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerTableCellLineBreak,
  TableCellLineBreakNode,
  tableCellLineBreakPlugin,
  tableCellLineBreakExportVisitor,
} from './mdxeditor-table-cell-line-break-plugin'

const mountedRoots: ReturnType<typeof createRoot>[] = []

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

describe('registerTableCellLineBreak', () => {
  it('shows a new line after the first Shift+Enter at the end of a table cell', () => {
    const { editor, root, unregister } = createEditor('td')
    const event = keyboardEvent({ key: 'Enter', shiftKey: true })

    expect(editor.dispatchCommand(lexical.KEY_DOWN_COMMAND, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(root.querySelectorAll('br')).toHaveLength(2)

    unregister()
  })

  it('inserts a visual break for Shift+Enter inside a table cell', () => {
    const { editor, root, unregister } = createEditor('td', 2)
    const event = keyboardEvent({ key: 'Enter', shiftKey: true })

    expect(editor.dispatchCommand(lexical.KEY_DOWN_COMMAND, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(root.querySelector('br')).not.toBeNull()

    editor.getEditorState().read(() => {
      const children = lexical.$getRoot().getFirstChildOrThrow().getChildren()
      expect(children).toHaveLength(3)
      expect(children[0].getTextContent()).toBe('借：')
      expect(children[1]).toBeInstanceOf(TableCellLineBreakNode)
      expect(children[2].getTextContent()).toBe('管理费用')
    })

    unregister()
  })

  it('exports one inline break for one Shift+Enter', () => {
    const { editor, unregister } = createEditor('td')
    editor.dispatchCommand(lexical.KEY_DOWN_COMMAND, keyboardEvent({ key: 'Enter', shiftKey: true }))

    const mdast = editor.getEditorState().read(() => exportLexicalTreeToMdast({
      root: lexical.$getRoot(),
      visitors: [
        {
          testLexicalNode: lexical.$isRootNode,
          visitLexicalNode: ({ actions }) => actions.addAndStepInto('root'),
        },
        {
          testLexicalNode: lexical.$isParagraphNode,
          visitLexicalNode: ({ actions }) => actions.addAndStepInto('paragraph'),
        },
        {
          testLexicalNode: lexical.$isTextNode,
          visitLexicalNode: ({ actions, lexicalNode, mdastParent }) => {
            actions.appendToParent(mdastParent, { type: 'text', value: lexicalNode.getTextContent() })
          },
        },
        tableCellLineBreakExportVisitor,
      ],
      jsxComponentDescriptors: [],
      jsxIsAvailable: true,
      addImportStatements: false,
    }))

    expect(mdast.children[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: '借：管理费用' },
        { type: 'mdxJsxTextElement', name: 'br', attributes: [], children: [] },
      ],
    })

    unregister()
  })

  it('preserves ordinary Enter for table navigation', () => {
    const { editor, unregister } = createEditor('th')
    const event = keyboardEvent({ key: 'Enter' })

    expect(editor.dispatchCommand(lexical.KEY_DOWN_COMMAND, event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(paragraphChildren(editor)).toHaveLength(1)

    unregister()
  })

  it('does not intercept Shift+Enter outside a table cell', () => {
    const { editor, unregister } = createEditor('div')
    const event = keyboardEvent({ key: 'Enter', shiftKey: true })

    expect(editor.dispatchCommand(lexical.KEY_DOWN_COMMAND, event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(paragraphChildren(editor)).toHaveLength(1)

    unregister()
  })

  it('commits a table cell line break to the root editor without waiting for blur', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const onChange = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mountedRoots.push(root)

    await act(async () => {
      root.render(createElement(MDXEditor, {
        ref: editorRef,
        markdown: '| A | B |\n| --- | --- |\n| first | second |',
        onChange,
        plugins: [tablePlugin(), tableCellLineBreakPlugin()],
      }))
      await Promise.resolve()
    })

    const cellEditor = host.querySelector<HTMLElement>('tbody td [contenteditable="true"]')
    if (!cellEditor) throw new Error('MDXEditor did not render the table cell editor')
    onChange.mockClear()

    await act(async () => {
      cellEditor.focus()
      await Promise.resolve()
    })

    await act(async () => {
      const text = cellEditor.querySelector('p')?.firstChild
      if (!text) throw new Error('MDXEditor did not render the table cell text')
      const selection = window.getSelection()
      const range = document.createRange()
      const offset = text.nodeType === Node.TEXT_NODE
        ? text.nodeValue?.length ?? 0
        : text.childNodes.length
      range.setStart(text, offset)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      cellEditor.dispatchEvent(keyboardEvent({ key: 'Enter', shiftKey: true }))
      await Promise.resolve()
    })

    expect(cellEditor.querySelector('br')).not.toBeNull()
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(editorRef.current?.getMarkdown()).toContain('<br />first')
    expect(document.activeElement).toBe(cellEditor)
  })
})

function createEditor(parentTagName: 'div' | 'td' | 'th', selectionOffset = '借：管理费用'.length) {
  const editor = lexical.createEditor({
    namespace: 'synapse-mdxeditor-table-cell-line-break-test',
    nodes: [TableCellLineBreakNode],
    onError: (error) => { throw error },
  })
  const parent = document.createElement(parentTagName)
  const root = document.createElement('div')
  parent.append(root)
  document.body.append(parent)
  editor.setRootElement(root)
  editor.update(() => {
    const paragraph = lexical.$createParagraphNode()
    const text = lexical.$createTextNode('借：管理费用')
    paragraph.append(text)
    lexical.$getRoot().append(paragraph)
    text.select(selectionOffset, selectionOffset)
  }, { discrete: true })

  return {
    editor,
    root,
    unregister: registerTableCellLineBreak(editor),
  }
}

function paragraphChildren(editor: ReturnType<typeof lexical.createEditor>) {
  return editor.getEditorState().read(() => lexical.$getRoot().getFirstChildOrThrow().getChildren())
}

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

// @vitest-environment jsdom

import {
  exportLexicalTreeToMdast,
  lexical,
} from '@mdxeditor/editor'
import { describe, expect, it } from 'vitest'
import {
  registerTableCellLineBreak,
  TableCellLineBreakNode,
  tableCellLineBreakExportVisitor,
} from './mdxeditor-table-cell-line-break-plugin'

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

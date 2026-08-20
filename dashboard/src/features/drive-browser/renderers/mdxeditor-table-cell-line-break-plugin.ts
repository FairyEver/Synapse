import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  createActiveEditorSubscription$,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'
import type {
  LexicalExportVisitor,
  MdastImportVisitor,
  MdastInlineHTMLNode,
} from '@mdxeditor/editor'

type LexicalEditor = ReturnType<typeof lexical.createEditor>

export const tableCellLineBreakPlugin = realmPlugin({
  init(realm) {
    realm.pub(addLexicalNode$, TableCellLineBreakNode)
    realm.pub(addImportVisitor$, tableCellLineBreakImportVisitor)
    realm.pub(addExportVisitor$, tableCellLineBreakExportVisitor)
    realm.pub(createActiveEditorSubscription$, registerTableCellLineBreak)
  },
})

export class TableCellLineBreakNode extends lexical.LineBreakNode {
  static getType(): string {
    return 'table-cell-line-break'
  }

  static clone(node: TableCellLineBreakNode): TableCellLineBreakNode {
    return new TableCellLineBreakNode(node.__key)
  }
}

export const tableCellLineBreakImportVisitor: MdastImportVisitor<MdastInlineHTMLNode> = {
  testNode: (node) => (
    node.type === 'mdxJsxTextElement' && node.name === 'br'
  ),
  visitNode({ lexicalParent }) {
    if (!lexical.$isElementNode(lexicalParent)) return
    lexicalParent.append($createTableCellLineBreakNode())
  },
  priority: 100,
}

export const tableCellLineBreakExportVisitor: LexicalExportVisitor<TableCellLineBreakNode, MdastInlineHTMLNode> = {
  testLexicalNode: (node: lexical.LexicalNode): node is TableCellLineBreakNode => node instanceof TableCellLineBreakNode,
  visitLexicalNode({ mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: 'mdxJsxTextElement',
      name: 'br',
      attributes: [],
      children: [],
    })
  },
  priority: 100,
}

export function registerTableCellLineBreak(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    lexical.KEY_DOWN_COMMAND,
    (event) => {
      if (!isTableCellLineBreak(event) || !isTableCellEditor(editor)) return false

      const selection = lexical.$getSelection()
      if (!lexical.$isRangeSelection(selection)) return false
      const anchorNode = selection.anchor.getNode()
      if (!lexical.$isTextNode(anchorNode) && !lexical.$isElementNode(anchorNode)) return false

      event.preventDefault()
      editor.update(insertTableCellLineBreak, { discrete: true })
      return true
    },
    lexical.COMMAND_PRIORITY_CRITICAL,
  )
}

function insertTableCellLineBreak(): void {
  const selection = lexical.$getSelection()
  if (!lexical.$isRangeSelection(selection)) return

  if (!selection.isCollapsed()) selection.removeText()
  const anchor = selection.anchor
  const anchorNode = anchor.getNode()
  const lineBreak = $createTableCellLineBreakNode()

  if (lexical.$isTextNode(anchorNode)) {
    const offset = anchor.offset
    if (offset === 0) {
      anchorNode.insertBefore(lineBreak)
    } else if (offset === anchorNode.getTextContentSize()) {
      anchorNode.insertAfter(lineBreak)
    } else {
      anchorNode.splitText(offset)[0].insertAfter(lineBreak)
    }
  } else if (lexical.$isElementNode(anchorNode)) {
    anchorNode.splice(anchor.offset, 0, [lineBreak])
  } else {
    return
  }

  const parent = lineBreak.getParentOrThrow()
  const nextOffset = lineBreak.getIndexWithinParent() + 1
  parent.select(nextOffset, nextOffset)
}

function $createTableCellLineBreakNode(): TableCellLineBreakNode {
  return lexical.$applyNodeReplacement(new TableCellLineBreakNode())
}

function isTableCellLineBreak(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    && event.shiftKey
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.isComposing
}

function isTableCellEditor(editor: LexicalEditor): boolean {
  return ['TD', 'TH'].includes(editor.getRootElement()?.parentElement?.tagName ?? '')
}

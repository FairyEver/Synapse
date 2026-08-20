import {
  $createGenericHTMLNode,
  createActiveEditorSubscription$,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'

type LexicalEditor = ReturnType<typeof lexical.createEditor>

export const tableCellLineBreakPlugin = realmPlugin({
  init(realm) {
    realm.pub(createActiveEditorSubscription$, registerTableCellLineBreak)
  },
})

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
  const lineBreak = $createGenericHTMLNode('br', 'mdxJsxTextElement', [])

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

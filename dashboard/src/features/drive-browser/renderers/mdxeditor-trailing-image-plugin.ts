import {
  $isImageNode,
  createRootEditorSubscription$,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'

type LexicalEditor = ReturnType<typeof lexical.createEditor>

export const trailingImageParagraphPlugin = realmPlugin({
  init(realm) {
    realm.pub(createRootEditorSubscription$, registerTrailingImageParagraph)
  },
})

export function registerTrailingImageParagraph(editor: LexicalEditor): () => void {
  const unregister = editor.registerUpdateListener(({ editorState }) => {
    let imageParagraphKey: string | null = null
    let moveSelection = false

    editorState.read(() => {
      const imageParagraph = getTerminalImageParagraph()
      if (!imageParagraph) return

      imageParagraphKey = imageParagraph.getKey()
      const selection = lexical.$getSelection()
      if (!lexical.$isRangeSelection(selection) || !selection.isCollapsed()) return
      moveSelection = selection.anchor.getNode().getTopLevelElement()?.is(imageParagraph) ?? false
    })

    if (!imageParagraphKey) return
    editor.update(() => {
      const imageParagraph = getTerminalImageParagraph()
      if (!imageParagraph || imageParagraph.getKey() !== imageParagraphKey) return

      const trailingParagraph = lexical.$createParagraphNode()
      imageParagraph.insertAfter(trailingParagraph)
      if (moveSelection) trailingParagraph.selectStart()
    }, { discrete: true })
  })

  editor.update(() => {
    const imageParagraph = getTerminalImageParagraph()
    if (imageParagraph) imageParagraph.insertAfter(lexical.$createParagraphNode())
  }, { discrete: true })

  return unregister
}

function getTerminalImageParagraph() {
  const lastChild = lexical.$getRoot().getLastChild()
  if (!lexical.$isParagraphNode(lastChild)) return null

  const children = lastChild.getChildren()
  return children.length > 0 && children.every($isImageNode) ? lastChild : null
}

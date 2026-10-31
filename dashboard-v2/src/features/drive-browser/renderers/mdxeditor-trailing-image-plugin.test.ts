import { $createImageNode, ImageNode, lexical } from '@mdxeditor/editor'
import { describe, expect, it } from 'vitest'
import { registerTrailingImageParagraph } from './mdxeditor-trailing-image-plugin'

describe('registerTrailingImageParagraph', () => {
  it('adds an empty paragraph after a terminal image paragraph and moves the caret into it', () => {
    const editor = createEditor()
    const unregister = registerTrailingImageParagraph(editor)

    editor.update(() => {
      const imageParagraph = lexical.$createParagraphNode()
      imageParagraph.append($createImageNode({ altText: 'chart', src: 'https://example.test/chart.png' }))
      lexical.$getRoot().append(imageParagraph)
      imageParagraph.selectEnd()
    }, { discrete: true })

    editor.getEditorState().read(() => {
      const children = lexical.$getRoot().getChildren()
      expect(children).toHaveLength(2)
      expect(lexical.$isParagraphNode(children[1])).toBe(true)
      expect(children[1].getChildrenSize()).toBe(0)

      const selection = lexical.$getSelection()
      expect(lexical.$isRangeSelection(selection)).toBe(true)
      if (!lexical.$isRangeSelection(selection)) return
      expect(selection.anchor.getNode().getTopLevelElementOrThrow().is(children[1])).toBe(true)
    })

    unregister()
  })

  it('does not add a paragraph after ordinary text content', () => {
    const editor = createEditor()
    const unregister = registerTrailingImageParagraph(editor)

    editor.update(() => {
      const paragraph = lexical.$createParagraphNode()
      paragraph.append(lexical.$createTextNode('Notes'))
      lexical.$getRoot().append(paragraph)
    }, { discrete: true })

    editor.getEditorState().read(() => {
      expect(lexical.$getRoot().getChildren()).toHaveLength(1)
    })

    unregister()
  })

  it('adds the editable paragraph when an existing document is registered', () => {
    const editor = createEditor()
    editor.update(() => {
      const imageParagraph = lexical.$createParagraphNode()
      imageParagraph.append($createImageNode({ altText: 'chart', src: 'https://example.test/chart.png' }))
      lexical.$getRoot().append(imageParagraph)
    }, { discrete: true })

    const unregister = registerTrailingImageParagraph(editor)

    editor.getEditorState().read(() => {
      const children = lexical.$getRoot().getChildren()
      expect(children).toHaveLength(2)
      expect(lexical.$isParagraphNode(children[1])).toBe(true)
      expect(children[1].getChildrenSize()).toBe(0)
    })

    unregister()
  })
})

function createEditor() {
  return lexical.createEditor({
    namespace: 'synapse-mdxeditor-trailing-image-test',
    nodes: [ImageNode],
    onError: (error) => { throw error },
  })
}

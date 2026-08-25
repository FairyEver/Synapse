import {
  addExportVisitor$,
  addImportVisitor$,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'

type LexicalListNode = {
  readonly getListType: () => 'bullet' | 'check' | 'number'
  readonly getStart: () => number
  readonly setStart: (start: number) => void
}

const LIST_VISITOR_PRIORITY = 100

export const orderedListStartPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, {
      priority: LIST_VISITOR_PRIORITY,
      testNode: 'list',
      visitNode({ mdastNode, lexicalParent, actions }) {
        actions.nextVisitor()
        const list = mdastNode as typeof mdastNode & {
          readonly ordered?: boolean | null
          readonly start?: number | null
        }
        if (!list.ordered || typeof list.start !== 'number') return

        const sibling = lexicalParent.getType() === 'listitem'
          ? lexicalParent.getNextSibling()
          : null
        const insertedNode = sibling && lexical.$isElementNode(sibling)
          ? sibling.getFirstChild()
          : lexical.$isElementNode(lexicalParent)
            ? lexicalParent.getLastChild()
            : null
        if (!isLexicalListNode(insertedNode)) return

        if (insertedNode.getListType() === 'number') {
          insertedNode.setStart(list.start)
        }
      },
    })

    realm.pub(addExportVisitor$, {
      priority: LIST_VISITOR_PRIORITY,
      testLexicalNode: isLexicalListNode,
      visitLexicalNode({ lexicalNode, actions }) {
        const listNode = lexicalNode as lexical.ElementNode & LexicalListNode
        const ordered = listNode.getListType() === 'number'
        actions.addAndStepInto('list', {
          ordered,
          spread: false,
          ...(ordered ? { start: listNode.getStart() } : {}),
        })
      },
    })
  },
})

function isLexicalListNode(node: lexical.LexicalNode | null | undefined): node is lexical.ElementNode & LexicalListNode {
  return Boolean(node && lexical.$isElementNode(node) && node.getType() === 'list')
}

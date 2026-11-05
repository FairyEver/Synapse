import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  $createImageNode,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'
import type {
  LexicalExportVisitor,
  MdastHTMLNode,
  MdastImportVisitor,
  ToMarkdownOptions,
} from '@mdxeditor/editor'

type MdastHtmlComment = {
  readonly type: 'html'
  readonly value: string
}
type MdastHardBreak = {
  readonly type: 'break'
}
type MdastText = {
  readonly type: 'text'
  readonly value: string
}
type MdastNode = Parameters<Exclude<MdastImportVisitor<MdastHTMLNode>['testNode'], string>>[0]
type MdastParagraph = Extract<MdastNode, { readonly type: 'paragraph' }>
type SerializedHtmlCommentNode = lexical.SerializedLexicalNode & {
  readonly type: 'html-comment'
  readonly version: 1
  readonly value: string
  readonly inline: boolean
}

export type PreparedCommonMark = {
  readonly markdown: string
  readonly requiresSourceMode: boolean
}

export class HtmlCommentNode extends lexical.DecoratorNode<null> {
  __value: string
  __inline: boolean

  static getType(): string {
    return 'html-comment'
  }

  static clone(node: HtmlCommentNode): HtmlCommentNode {
    return new HtmlCommentNode(node.__value, node.__inline, node.__key)
  }

  static importJSON(serializedNode: SerializedHtmlCommentNode): HtmlCommentNode {
    return $createHtmlCommentNode(serializedNode.value, serializedNode.inline)
  }

  constructor(value: string, inline: boolean, key?: lexical.NodeKey) {
    super(key)
    this.__value = value
    this.__inline = inline
  }

  exportJSON(): SerializedHtmlCommentNode {
    return {
      ...super.exportJSON(),
      type: 'html-comment',
      version: 1,
      value: this.getValue(),
      inline: this.isInline(),
    }
  }

  createDOM(): HTMLElement {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.hidden = true
    return element
  }

  updateDOM(): false {
    return false
  }

  decorate(): null {
    return null
  }

  getValue(): string {
    return this.getLatest().__value
  }

  isInline(): boolean {
    return this.getLatest().__inline
  }
}

type SerializedHtmlSourceNode = lexical.SerializedLexicalNode & {
  readonly type: 'commonmark-html-source'
  readonly version: 1
  readonly value: string
  readonly inline: boolean
}

// Preserve unsupported HTML as inert source instead of dropping it or parsing JSX.
export class HtmlSourceNode extends lexical.DecoratorNode<string> {
  __value: string
  __inline: boolean

  static getType(): string {
    return 'commonmark-html-source'
  }
  static clone(node: HtmlSourceNode): HtmlSourceNode {
    return new HtmlSourceNode(node.__value, node.__inline, node.__key)
  }
  static importJSON(node: SerializedHtmlSourceNode): HtmlSourceNode {
    return new HtmlSourceNode(node.value, node.inline)
  }
  constructor(value: string, inline: boolean, key?: lexical.NodeKey) {
    super(key)
    this.__value = value
    this.__inline = inline
  }
  exportJSON(): SerializedHtmlSourceNode {
    return {
      ...super.exportJSON(),
      type: 'commonmark-html-source',
      version: 1,
      value: this.getTextContent(),
      inline: this.isInline(),
    }
  }
  getTextContent(): string {
    return this.getLatest().__value
  }
  isInline(): boolean {
    return this.getLatest().__inline
  }
  createDOM(): HTMLElement {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.dataset.driveMarkdownCommentExcluded = 'true'
    element.dataset.driveMarkdownHtmlSource = 'true'
    element.className = 'whitespace-pre-wrap font-mono'
    return element
  }
  updateDOM(): false {
    return false
  }
  decorate(): string {
    return this.getTextContent()
  }
}

export const htmlSourceImportVisitor: MdastImportVisitor<MdastHtmlComment> = {
  testNode: 'html',
  priority: 50,
  visitNode({ mdastNode, mdastParent, lexicalParent }) {
    if (!lexical.$isElementNode(lexicalParent)) throw new Error('HTML source requires an element parent')
    const template = document.createElement('template')
    template.innerHTML = mdastNode.value
    const children = Array.from(template.content.childNodes).filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim())
    const image = children.length === 1 && children[0] instanceof HTMLImageElement ? children[0] : null
    const allowedImageAttributes = ['src', 'alt', 'title', 'width', 'height']
    const src = image?.getAttribute('src')
    const dimensions = ['width', 'height'].map(name => image?.getAttribute(name) ?? null)
    const supportedDimensions = dimensions.every(value => value === null
      || (/^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))))
    // Sized ImageNodes use an upstream HTML exporter that interpolates src without escaping.
    const safeSizedSource = dimensions.every(value => value === null) || !/[&"<>\r\n]/u.test(src ?? '')
    const node = image && src && supportedDimensions && safeSizedSource
      && image.getAttributeNames().every(name => allowedImageAttributes.includes(name))
      ? $createImageNode({
          src,
          altText: image.getAttribute('alt') ?? '',
          title: image.getAttribute('title') ?? '',
          width: Number(image.getAttribute('width')) || undefined,
          height: Number(image.getAttribute('height')) || undefined,
        })
      : lexical.$applyNodeReplacement(new HtmlSourceNode(mdastNode.value, mdastParent?.type === 'paragraph' || mdastParent?.type === 'tableCell'))
    if (lexicalParent.getType() === 'root' && node.isInline()) {
      lexicalParent.append(lexical.$createParagraphNode().append(node))
    } else {
      lexicalParent.append(node)
    }
  },
}

export const htmlSourceExportVisitor: LexicalExportVisitor<HtmlSourceNode, MdastHtmlComment> = {
  testLexicalNode: (node): node is HtmlSourceNode => node instanceof HtmlSourceNode,
  priority: 100,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, { type: 'html', value: lexicalNode.getTextContent() })
  },
}

export class CommentExcludedParagraphBreakNode extends lexical.LineBreakNode {
  static getType(): string {
    return 'comment-excluded-paragraph-break'
  }

  static clone(node: CommentExcludedParagraphBreakNode): CommentExcludedParagraphBreakNode {
    return new CommentExcludedParagraphBreakNode(node.getKey())
  }

  static importJSON(): CommentExcludedParagraphBreakNode {
    return $createCommentExcludedParagraphBreakNode()
  }

  createDOM(): HTMLElement {
    const element = document.createElement('br')
    element.dataset.driveMarkdownCommentExcluded = 'true'
    return element
  }

  exportJSON(): lexical.SerializedLineBreakNode {
    return {
      ...super.exportJSON(),
      type: 'comment-excluded-paragraph-break' as 'linebreak',
    }
  }
}

function $createCommentExcludedParagraphBreakNode(): CommentExcludedParagraphBreakNode {
  return lexical.$applyNodeReplacement(new CommentExcludedParagraphBreakNode())
}

export const commentAwareParagraphImportVisitor: MdastImportVisitor<MdastParagraph> = {
  testNode: 'paragraph',
  visitNode({ mdastNode, mdastParent, lexicalParent, actions }) {
    const parentType = lexicalParent.getType()
    if (
      (parentType === 'listitem' || parentType === 'admonition')
      && lexical.$isElementNode(lexicalParent)
    ) {
      const nodeIndex = mdastParent?.children.indexOf(mdastNode) ?? -1
      const previousSibling = nodeIndex > 0 ? mdastParent?.children[nodeIndex - 1] : undefined
      if (parentType === 'listitem' && previousSibling?.type === 'paragraph') {
        lexicalParent.append(
          $createCommentExcludedParagraphBreakNode(),
          $createCommentExcludedParagraphBreakNode(),
        )
      }
      actions.visitChildren(mdastNode, lexicalParent)
      return
    }
    actions.addAndStepInto(lexical.$createParagraphNode())
  },
  priority: 100,
}

export const commentExcludedParagraphBreakExportVisitor: LexicalExportVisitor<CommentExcludedParagraphBreakNode, MdastText> = {
  testLexicalNode: (node): node is CommentExcludedParagraphBreakNode => node instanceof CommentExcludedParagraphBreakNode,
  visitLexicalNode({ mdastParent, actions }) {
    actions.appendToParent(mdastParent, { type: 'text', value: '\n' })
  },
  priority: 200,
}

export const htmlCommentImportVisitor: MdastImportVisitor<MdastHtmlComment> = {
  testNode: (node): node is MdastHtmlComment => node.type === 'html' && /^<!--[\s\S]*-->$/u.test(node.value),
  visitNode({ mdastNode, mdastParent, actions }) {
    actions.addAndStepInto($createHtmlCommentNode(mdastNode.value, mdastParent?.type === 'paragraph'))
  },
  priority: 100,
}

export const htmlCommentExportVisitor: LexicalExportVisitor<HtmlCommentNode, MdastHtmlComment> = {
  testLexicalNode: (node): node is HtmlCommentNode => node instanceof HtmlCommentNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: 'html',
      value: lexicalNode.getValue(),
    })
  },
  priority: 100,
}

export const commonMarkHardBreakExportVisitor: LexicalExportVisitor<lexical.LineBreakNode, MdastHardBreak> = {
  testLexicalNode: lexical.$isLineBreakNode,
  visitLexicalNode({ mdastParent, actions }) {
    actions.appendToParent(mdastParent, { type: 'break' })
  },
  priority: 100,
}

export const commonMarkTextCompatibilityPlugin = realmPlugin({
  init(realm) {
    realm.pub(addLexicalNode$, HtmlCommentNode)
    realm.pub(addLexicalNode$, HtmlSourceNode)
    realm.pub(addLexicalNode$, CommentExcludedParagraphBreakNode)
    realm.pub(addImportVisitor$, htmlCommentImportVisitor)
    realm.pub(addImportVisitor$, htmlSourceImportVisitor)
    realm.pub(addImportVisitor$, commentAwareParagraphImportVisitor)
    realm.pub(addExportVisitor$, htmlCommentExportVisitor)
    realm.pub(addExportVisitor$, htmlSourceExportVisitor)
    realm.pub(addExportVisitor$, commonMarkHardBreakExportVisitor)
    realm.pub(addExportVisitor$, commentExcludedParagraphBreakExportVisitor)
  },
})

export function prepareCommonMarkForMdxEditor(markdown: string): PreparedCommonMark {
  if (containsMixedTaskList(markdown)) return { markdown, requiresSourceMode: true }

  return { markdown, requiresSourceMode: false }
}

function containsMixedTaskList(markdown: string): boolean {
  const listStates = new Map<number, { hasPlainItem: boolean; hasTaskItem: boolean }>()
  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null

  for (const line of markdown.split(/\r?\n/u)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const sequence = fenceMatch[1]
      const marker = sequence[0] as '`' | '~'
      if (!fence) fence = { marker, length: sequence.length }
      else if (marker === fence.marker && sequence.length >= fence.length) fence = null
      continue
    }
    if (fence) continue

    const itemMatch = /^([ \t]*)[*+-][ \t]+(?:\[([ xX])\](?:[ \t]+|$))?/u.exec(line)
    if (itemMatch) {
      const indent = markdownIndentWidth(itemMatch[1])
      for (const existingIndent of listStates.keys()) {
        if (existingIndent > indent) listStates.delete(existingIndent)
      }
      const state = listStates.get(indent) ?? { hasPlainItem: false, hasTaskItem: false }
      if (itemMatch[2] === undefined) state.hasPlainItem = true
      else state.hasTaskItem = true
      if (state.hasPlainItem && state.hasTaskItem) return true
      listStates.set(indent, state)
      continue
    }

    if (!line.trim()) continue
    const indent = markdownLeadingIndent(line)
    if ([...listStates.keys()].some((listIndent) => indent > listIndent)) continue
    listStates.clear()
  }
  return false
}

export const commonMarkToMarkdownOptions = {
  resourceLink: false,
  handlers: {
    text(node, _parent, state, info) {
      return state.safe(node.value, info)
        .replace(/\\<\\=/gu, '<=')
        .replace(/\\<=/gu, '<=')
        .replace(/([A-Z_$][A-Za-z\d_$]*)\\</gu, '$1<')
    },
  },
} satisfies ToMarkdownOptions

function markdownLeadingIndent(line: string): number {
  return markdownIndentWidth(/^[ \t]*/u.exec(line)?.[0] ?? '')
}

function markdownIndentWidth(value: string): number {
  let width = 0
  for (const character of value) width += character === '\t' ? 4 : 1
  return width
}

function $createHtmlCommentNode(value: string, inline: boolean): HtmlCommentNode {
  return lexical.$applyNodeReplacement(new HtmlCommentNode(value, inline))
}

import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  GenericHTMLNode,
  isMdastHTMLNode,
  lexical,
  realmPlugin,
} from '@mdxeditor/editor'
import type {
  FromMarkdownOptions,
  KnownHTMLTagType,
  LexicalExportVisitor,
  MdastHTMLNode,
  MdastImportVisitor,
  MdxNodeType,
  SerializedGenericHTMLNode,
  ToMarkdownOptions,
} from '@mdxeditor/editor'

type MarkdownSyntaxExtension = NonNullable<FromMarkdownOptions['extensions']>[number]
type MarkdownMdastExtension = NonNullable<FromMarkdownOptions['mdastExtensions']>[number]
type MdxJsxAttributes = ReturnType<GenericHTMLNode['getAttributes']>
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

const LESS_THAN_CODE = 60
const EQUALS_CODE = 61

export const commonMarkLessThanOrEqualSyntaxExtension = {
  text: {
    [LESS_THAN_CODE]: {
      tokenize(effects, ok, nok) {
        return start

        function start(code: number | null) {
          if (code !== LESS_THAN_CODE) return nok(code)
          effects.enter('data')
          effects.consume(code)
          return afterLessThan
        }

        function afterLessThan(code: number | null) {
          if (code !== EQUALS_CODE) return nok(code)
          effects.exit('data')
          return ok(code)
        }
      },
    },
  },
} satisfies MarkdownSyntaxExtension

export const commonMarkHtmlCommentFromMarkdownExtension = {
  canContainEols: ['comment'],
  enter: {
    comment(token) {
      this.enter({ type: 'html', value: '' }, token)
      this.buffer()
    },
  },
  exit: {
    comment(token) {
      const value = this.resume()
      const node = this.stack[this.stack.length - 1]
      if (node?.type === 'html') node.value = `<!--${value}>`
      this.exit(token)
    },
  },
} satisfies MarkdownMdastExtension

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

export class CommentExcludedHtmlBlockNode extends GenericHTMLNode {
  static getType(): string {
    return 'comment-excluded-html-block'
  }

  static clone(node: CommentExcludedHtmlBlockNode): CommentExcludedHtmlBlockNode {
    return new CommentExcludedHtmlBlockNode(
      node.getTag(),
      node.getNodeType(),
      node.getAttributes(),
      node.getKey(),
    )
  }

  static importJSON(serializedNode: SerializedGenericHTMLNode): CommentExcludedHtmlBlockNode {
    return $createCommentExcludedHtmlBlockNode(
      serializedNode.tag,
      serializedNode.mdxType,
      serializedNode.attributes,
    )
  }

  constructor(tag: KnownHTMLTagType, type: MdxNodeType, attributes: MdxJsxAttributes, key?: lexical.NodeKey) {
    super(tag, type, attributes, key)
  }

  createDOM(): HTMLElement {
    const element = super.createDOM()
    element.dataset.driveMarkdownCommentExcluded = 'true'
    return element
  }

  exportJSON(): SerializedGenericHTMLNode {
    return {
      ...super.exportJSON(),
      type: 'comment-excluded-html-block' as 'generic-html',
    }
  }
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

function $createCommentExcludedHtmlBlockNode(
  tag: KnownHTMLTagType,
  type: MdxNodeType,
  attributes: MdxJsxAttributes,
): CommentExcludedHtmlBlockNode {
  return lexical.$applyNodeReplacement(new CommentExcludedHtmlBlockNode(tag, type, attributes))
}

function requireNamedMdxJsxAttributes(attributes: MdastHTMLNode['attributes']): MdxJsxAttributes {
  if (attributes.every(
    (attribute): attribute is MdxJsxAttributes[number] => attribute.type === 'mdxJsxAttribute',
  )) return attributes
  throw new Error('CommonMark HTML elements cannot contain spread attributes')
}

export const commentExcludedHtmlBlockImportVisitor: MdastImportVisitor<MdastHTMLNode> = {
  testNode: (node): node is MdastHTMLNode => isMdastHTMLNode(node) && node.type === 'mdxJsxFlowElement',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto($createCommentExcludedHtmlBlockNode(
      mdastNode.name,
      mdastNode.type,
      requireNamedMdxJsxAttributes(mdastNode.attributes),
    ))
  },
  priority: 100,
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
    realm.pub(addSyntaxExtension$, commonMarkLessThanOrEqualSyntaxExtension)
    realm.pub(addMdastExtension$, commonMarkHtmlCommentFromMarkdownExtension)
    realm.pub(addLexicalNode$, HtmlCommentNode)
    realm.pub(addLexicalNode$, CommentExcludedHtmlBlockNode)
    realm.pub(addLexicalNode$, CommentExcludedParagraphBreakNode)
    realm.pub(addImportVisitor$, htmlCommentImportVisitor)
    realm.pub(addImportVisitor$, commentExcludedHtmlBlockImportVisitor)
    realm.pub(addImportVisitor$, commentAwareParagraphImportVisitor)
    realm.pub(addExportVisitor$, htmlCommentExportVisitor)
    realm.pub(addExportVisitor$, commonMarkHardBreakExportVisitor)
    realm.pub(addExportVisitor$, commentExcludedParagraphBreakExportVisitor)
  },
})

export function prepareCommonMarkForMdxEditor(markdown: string): PreparedCommonMark {
  if (containsMixedTaskList(markdown)) return { markdown, requiresSourceMode: true }

  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null
  let inlineCodeMarker: string | null = null
  let htmlCommentOpen = false
  let activeListContentIndent: number | null = null

  const prepared = markdown.split(/(\r?\n)/u).map((line) => {
    if (/^\r?\n$/u.test(line)) return line

    if (!htmlCommentOpen) {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
      if (fenceMatch) {
        const sequence = fenceMatch[1]
        const marker = sequence[0] as '`' | '~'
        if (!fence) {
          if (marker === '~' || !fenceMatch[2].includes('`')) {
            fence = { marker, length: sequence.length }
          }
        } else if (
          marker === fence.marker
          && sequence.length >= fence.length
          && /^\s*$/u.test(fenceMatch[2])
        ) {
          fence = null
        }
        return line
      }
      if (fence) return line

      const listIndent = markdownListContentIndent(line)
      const leadingIndent = markdownLeadingIndent(line)
      if (listIndent !== null && (leadingIndent <= 3 || activeListContentIndent !== null)) {
        activeListContentIndent = listIndent
      } else if (/\S/u.test(line)) {
        if (activeListContentIndent !== null && leadingIndent < activeListContentIndent) {
          activeListContentIndent = null
        }
        if (
          leadingIndent >= 4
          && (activeListContentIndent === null || leadingIndent >= activeListContentIndent + 4)
        ) return line
      }
    }

    let result = ''
    for (let index = 0; index < line.length;) {
      if (htmlCommentOpen) {
        const closingIndex = line.indexOf('-->', index)
        if (closingIndex < 0) {
          result += line.slice(index)
          break
        }
        result += line.slice(index, closingIndex + 3)
        index = closingIndex + 3
        htmlCommentOpen = false
        continue
      }

      if (line[index] === '`' && !isEscaped(line, index)) {
        const marker = /^`+/u.exec(line.slice(index))?.[0] ?? '`'
        inlineCodeMarker = inlineCodeMarker === marker ? null : inlineCodeMarker ?? marker
        result += marker
        index += marker.length
        continue
      }

      if (inlineCodeMarker || line[index] !== '<' || isEscaped(line, index)) {
        result += line[index]
        index += 1
        continue
      }

      if (line[index + 1] === '=') {
        result += '\\<='
        index += 2
        continue
      }

      if (line.startsWith('<!--', index)) {
        const closingIndex = line.indexOf('-->', index + 4)
        if (closingIndex < 0) {
          result += line.slice(index)
          htmlCommentOpen = true
          break
        }
        result += line.slice(index, closingIndex + 3)
        index = closingIndex + 3
        continue
      }

      const breakTag = /^<br\s*\/?\s*>/iu.exec(line.slice(index))?.[0]
      if (breakTag) {
        result += breakTag.includes('/') ? breakTag : '<br />'
        index += breakTag.length
        continue
      }

      const closingIndex = line.indexOf('>', index + 1)
      const candidate = closingIndex >= 0 ? line.slice(index + 1, closingIndex) : ''
      if (closingIndex >= 0 && isExistingLinkDestination(line, index)) {
        result += line.slice(index, closingIndex + 1)
        index = closingIndex + 1
        continue
      }
      if (closingIndex >= 0) {
        if (isCommonMarkUriAutolink(candidate)) {
          result += `[${escapeMarkdownLinkLabel(candidate)}](<${candidate}>)`
          index = closingIndex + 1
          continue
        }
        if (isCommonMarkEmailAutolink(candidate)) {
          result += `[${escapeMarkdownLinkLabel(candidate)}](<mailto:${candidate}>)`
          index = closingIndex + 1
          continue
        }
      }

      if (isProgrammingLanguageGenericOpening(line, index)) {
        result += '\\<'
        index += 1
        continue
      }

      result += line[index]
      index += 1
    }
    return result
  }).join('')

  return { markdown: prepared, requiresSourceMode: false }
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

function isExistingLinkDestination(line: string, index: number): boolean {
  if (line[index - 1] === '(') return true
  return /^ {0,3}\[[^\]\r\n]+\]:\s*$/u.test(line.slice(0, index))
}

function markdownListContentIndent(line: string): number | null {
  const match = /^([ \t]*)(?:[*+-]|\d{1,9}[.)])([ \t]+)/u.exec(line)
  if (!match) return null
  const markerLength = match[0].length - match[1].length - match[2].length
  return markdownIndentWidth(match[1]) + markerLength + markdownIndentWidth(match[2])
}

function markdownLeadingIndent(line: string): number {
  return markdownIndentWidth(/^[ \t]*/u.exec(line)?.[0] ?? '')
}

function markdownIndentWidth(value: string): number {
  let width = 0
  for (const character of value) width += character === '\t' ? 4 : 1
  return width
}

function isCommonMarkUriAutolink(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]{1,31}:[^\u0000-\u0020<>]*$/u.test(value)
}

function isCommonMarkEmailAutolink(value: string): boolean {
  return /^[A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?(?:\.[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?)*$/u.test(value)
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[\\\[\]]/gu, '\\$&')
}

function isProgrammingLanguageGenericOpening(value: string, index: number): boolean {
  if (!/([A-Z_$][A-Za-z\d_$]*)$/u.test(value.slice(0, index))) return false

  let depth = 1
  for (let cursor = index + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor]
    if (character === '<') {
      depth += 1
      continue
    }
    if (character === '>') {
      depth -= 1
      if (depth === 0) return true
      continue
    }
    if (!/[A-Za-z\d_$.,?&\s\[\]]/u.test(character)) return false
  }
  return false
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashCount += 1
  return backslashCount % 2 === 1
}

function $createHtmlCommentNode(value: string, inline: boolean): HtmlCommentNode {
  return lexical.$applyNodeReplacement(new HtmlCommentNode(value, inline))
}

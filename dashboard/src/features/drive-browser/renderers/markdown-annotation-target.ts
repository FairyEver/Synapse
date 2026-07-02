import {
  DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH,
  type DriveAnnotationTextRangeTargetV1,
} from '@synapse/shared'

const CONTEXT_LENGTH = 80

export function createMarkdownAnnotationTargetFromSelection(
  root: HTMLElement,
  selection: Selection | null,
): DriveAnnotationTextRangeTargetV1 | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!rootContainsRange(root, range)) return null

  const exact = getRangeRenderedText(range)
  if (!exact.trim()) return null
  if (exact.length > DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH) return null

  const beforeRange = document.createRange()
  beforeRange.selectNodeContents(root)
  beforeRange.setEnd(range.startContainer, range.startOffset)
  const start = getRangeRenderedText(beforeRange).length
  beforeRange.detach()

  const end = start + exact.length
  const renderedText = getMarkdownRenderedText(root)
  return {
    schemaVersion: 1,
    kind: 'textRange',
    surface: 'markdownRenderedText',
    range: { start, end },
    quote: {
      exact,
      prefix: renderedText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: renderedText.slice(end, end + CONTEXT_LENGTH),
    },
  }
}

export function getMarkdownRenderedText(root: Node): string {
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isAnnotationMarkerText(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let current = walker.nextNode()
  while (current) {
    text += current.textContent ?? ''
    current = walker.nextNode()
  }
  return text
}

function getRangeRenderedText(range: Range): string {
  const fragment = range.cloneContents()
  return getMarkdownRenderedText(fragment)
}

function rootContainsRange(root: HTMLElement, range: Range): boolean {
  return rootContainsNode(root, range.startContainer)
    && rootContainsNode(root, range.endContainer)
    && rootContainsNode(root, range.commonAncestorContainer)
}

function rootContainsNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node)
}

function isAnnotationMarkerText(node: Node): boolean {
  const parent = node.parentElement
  return Boolean(parent?.closest('[data-drive-annotation-marker="true"]'))
}

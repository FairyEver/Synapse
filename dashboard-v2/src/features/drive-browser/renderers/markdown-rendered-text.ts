import type { DriveMarkdownProjectionDto } from '@synapse/shared'

type MarkdownRenderedDomPoint = {
  readonly node: Node
  readonly offset: number
}

export type MarkdownRenderedTextSegment = {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly startPoint: MarkdownRenderedDomPoint
  readonly endPoint: MarkdownRenderedDomPoint
  readonly textNode?: Text
}

export type MarkdownRenderedTextModel = {
  readonly text: string
  readonly segments: readonly MarkdownRenderedTextSegment[]
}

export function createMarkdownRenderedTextModel(
  root: Node,
  projection?: DriveMarkdownProjectionDto | null,
): MarkdownRenderedTextModel {
  const segments: MarkdownRenderedTextSegment[] = []
  const values: string[] = []
  const projectedLengthBySegmentId = new Map(
    projection?.segments.map((segment) => [segment.segmentId, segment.renderedEnd - segment.renderedStart]) ?? []
  )
  let offset = 0

  const append = (
    text: string,
    startPoint: MarkdownRenderedDomPoint,
    endPoint: MarkdownRenderedDomPoint,
    textNode?: Text,
  ) => {
    if (!text) return
    const segment = {
      text,
      start: offset,
      end: offset + text.length,
      startPoint,
      endPoint,
      ...(textNode ? { textNode } : {}),
    }
    values.push(text)
    segments.push(segment)
    offset = segment.end
  }

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (isNonRenderedText(node)) return
      const textNode = node as Text
      const text = canonicalTextNodeValue(textNode, projectedLengthBySegmentId)
      const bounds = canonicalTextNodeBounds(textNode, text)
      append(
        text.slice(bounds.start, bounds.end),
        { node: textNode, offset: bounds.start },
        { node: textNode, offset: bounds.end },
        textNode,
      )
      return
    }

    if (node instanceof HTMLElement) {
      if (node.matches('[data-drive-mermaid-rendered="true"]')) return
      if (node.matches('[data-drive-markdown-image-fallback-host="true"]')) return
      if (node.closest('[data-drive-annotation-marker="true"]')) return
      if (node.tagName === 'IMG') {
        const points = elementBoundaryPoints(node)
        if (points) append(node.getAttribute('alt') ?? '', points.start, points.end)
        return
      }
      if (node.tagName === 'BR') {
        const points = elementBoundaryPoints(node)
        if (points) append('\n', points.start, points.end)
        return
      }
    }

    for (const child of node.childNodes) visit(child)
  }

  visit(root)
  return { text: values.join(''), segments }
}

export function getMarkdownRenderedText(
  root: Node,
  projection?: DriveMarkdownProjectionDto | null,
): string {
  return createMarkdownRenderedTextModel(root, projection).text
}

export function getMarkdownRangeRenderedText(
  range: Range,
  projection?: DriveMarkdownProjectionDto | null,
): string {
  return getMarkdownRenderedText(range.cloneContents(), projection)
}

export function createMarkdownRenderedDomRange(
  root: HTMLElement,
  segments: readonly MarkdownRenderedTextSegment[],
  start: number,
  end: number,
): Range | null {
  if (start >= end) return null
  const startPoint = findRenderedTextPoint(segments, start, 'start')
  const endPoint = findRenderedTextPoint(segments, end, 'end')
  if (!startPoint || !endPoint) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function canonicalTextNodeValue(
  node: Text,
  projectedLengthBySegmentId: ReadonlyMap<string, number>,
): string {
  const value = node.textContent ?? ''
  const code = node.parentElement
  if (code?.tagName !== 'CODE' || code.parentElement?.tagName !== 'PRE' || code.childNodes.length !== 1) {
    return value
  }
  const segmentId = code.getAttribute('data-drive-markdown-segment-id')
  const projectedLength = segmentId ? projectedLengthBySegmentId.get(segmentId) : undefined
  if (projectedLength !== undefined) {
    const points = Array.from(value)
    return points.length === projectedLength + 1 && points[points.length - 1] === '\n'
      ? points.slice(0, projectedLength).join('')
      : value
  }
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

function elementBoundaryPoints(element: Element): {
  readonly start: MarkdownRenderedDomPoint
  readonly end: MarkdownRenderedDomPoint
} | null {
  const parent = element.parentNode
  if (!parent) return null
  const index = Array.prototype.indexOf.call(parent.childNodes, element) as number
  if (index < 0) return null
  return {
    start: { node: parent, offset: index },
    end: { node: parent, offset: index + 1 },
  }
}

function findRenderedTextPoint(
  segments: readonly MarkdownRenderedTextSegment[],
  offset: number,
  affinity: 'start' | 'end',
): MarkdownRenderedDomPoint | null {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (offset < segment.start || offset > segment.end) continue
    if (offset === segment.start) {
      if (affinity === 'end' && index > 0 && segments[index - 1]?.end === offset) {
        return segments[index - 1]?.endPoint ?? segment.startPoint
      }
      return segment.startPoint
    }
    if (offset === segment.end) {
      if (affinity === 'start' && segments[index + 1]?.start === offset) {
        return segments[index + 1]?.startPoint ?? segment.endPoint
      }
      return segment.endPoint
    }
    if (!segment.textNode) return affinity === 'start' ? segment.startPoint : segment.endPoint
    return { node: segment.textNode, offset: segment.startPoint.offset + offset - segment.start }
  }
  return null
}

function isNonRenderedText(node: Node): boolean {
  const parent = node.parentElement
  if (parent?.closest('[data-drive-annotation-marker="true"]')) return true
  if (node.textContent?.trim() || parent?.closest('pre, code')) return false
  if (parent?.closest('p, h1, h2, h3, h4, h5, h6, a, em, strong, del, s')) return false
  if (!parent?.matches('li, td, th')) return true
  return isMarkdownBlockElement(renderedSibling(node, 'previous'))
    || isMarkdownBlockElement(renderedSibling(node, 'next'))
}

function canonicalTextNodeBounds(node: Text, text: string): { readonly start: number; readonly end: number } {
  const parent = node.parentElement
  let start = 0
  let end = text.length
  const previous = renderedSibling(node, 'previous')
  const next = renderedSibling(node, 'next')
  if (previous instanceof HTMLElement && previous.tagName === 'BR') {
    start = text.match(/^\r?\n/u)?.[0].length ?? 0
  }
  if (parent?.matches('li.task-list-item') && previous instanceof HTMLElement && previous.matches('input[type="checkbox"]')) {
    start = text.match(/^\s*/u)?.[0].length ?? 0
  }
  if (parent?.matches('li, td, th')) {
    if (isMarkdownBlockElement(previous)) start = Math.max(start, text.match(/^\s*/u)?.[0].length ?? 0)
    if (isMarkdownBlockElement(next)) end = text.match(/\s*$/u)?.index ?? end
  }
  return { start, end: Math.max(start, end) }
}

function renderedSibling(node: Node, direction: 'previous' | 'next'): ChildNode | null {
  let sibling = direction === 'previous' ? node.previousSibling : node.nextSibling
  while (sibling instanceof HTMLElement && sibling.matches('[data-drive-annotation-marker="true"]')) {
    sibling = direction === 'previous' ? sibling.previousSibling : sibling.nextSibling
  }
  return sibling
}

function isMarkdownBlockElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement
    && node.matches('blockquote, div, figure, h1, h2, h3, h4, h5, h6, ol, p, pre, table, ul')
}

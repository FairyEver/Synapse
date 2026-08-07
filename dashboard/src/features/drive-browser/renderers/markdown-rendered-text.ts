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
      append(
        text,
        { node: textNode, offset: 0 },
        { node: textNode, offset: text.length },
        textNode,
      )
      return
    }

    if (node instanceof HTMLElement) {
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
  return !parent?.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, a, em, strong, del, s')
}

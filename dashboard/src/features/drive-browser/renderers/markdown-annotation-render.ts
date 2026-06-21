import type {
  DriveAnnotationAnchorStatus,
  DriveAnnotationTextRangeTargetV1,
  DriveAnnotationThreadDto,
} from '@synapse/shared'
import { getMarkdownRenderedText } from './markdown-annotation-target'

export type MarkdownAnnotationResolvedRange = {
  readonly threadId: string
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly range: { readonly start: number; readonly end: number } | null
}

export type MarkdownAnnotationHtmlResult = {
  readonly html: string
  readonly resolved: readonly MarkdownAnnotationResolvedRange[]
}

export function renderMarkdownAnnotationHtml(
  html: string,
  threads: readonly DriveAnnotationThreadDto[],
): MarkdownAnnotationHtmlResult {
  if (threads.length === 0) return { html, resolved: [] }
  const template = document.createElement('template')
  template.innerHTML = html
  const renderedText = getMarkdownRenderedText(template.content)
  const resolved = threads.map((thread) => ({
    threadId: thread.id,
    ...resolveTextRange(thread.target, renderedText),
  }))
  const ranges = resolved
    .filter((item): item is MarkdownAnnotationResolvedRange & { readonly range: { readonly start: number; readonly end: number } } => Boolean(item.range))
    .sort((a, b) => b.range.start - a.range.start)

  for (const item of ranges) {
    wrapRenderedTextRange(template.content, item.range.start, item.range.end, item.threadId)
  }

  return { html: template.innerHTML, resolved }
}

function resolveTextRange(
  target: DriveAnnotationTextRangeTargetV1,
  renderedText: string,
): Omit<MarkdownAnnotationResolvedRange, 'threadId'> {
  const direct = renderedText.slice(target.range.start, target.range.end)
  if (direct === target.quote.exact) return { anchorStatus: 'attached', range: target.range }

  const matches = findAllMatches(renderedText, target.quote.exact)
  if (matches.length === 0) return { anchorStatus: 'orphaned', range: null }
  if (matches.length > 1 && !target.quote.prefix && !target.quote.suffix) {
    return { anchorStatus: 'orphaned', range: null }
  }

  const scored = matches
    .map((range) => ({ range, score: scoreMatch(renderedText, target, range) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.score <= 0) return { anchorStatus: 'orphaned', range: null }
  if (second && second.score === best.score) return { anchorStatus: 'orphaned', range: null }
  return { anchorStatus: 'shifted', range: best.range }
}

function wrapRenderedTextRange(root: Node, start: number, end: number, threadId: string): void {
  const segments = collectTextSegments(root)
  for (const segment of segments) {
    const intersectionStart = Math.max(start, segment.start)
    const intersectionEnd = Math.min(end, segment.end)
    if (intersectionStart >= intersectionEnd) continue
    wrapTextNodeSlice(segment.node, intersectionStart - segment.start, intersectionEnd - segment.start, threadId)
  }
}

function wrapTextNodeSlice(node: Text, start: number, end: number, threadId: string): void {
  const parent = node.parentNode
  if (!parent) return
  const text = node.data
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)
  const marker = document.createElement('span')
  marker.dataset.driveAnnotationThreadId = threadId
  marker.className = 'rounded-sm bg-muted px-0.5 underline decoration-border'
  marker.textContent = selected

  if (before) parent.insertBefore(document.createTextNode(before), node)
  parent.insertBefore(marker, node)
  if (after) parent.insertBefore(document.createTextNode(after), node)
  parent.removeChild(node)
}

function collectTextSegments(root: Node): Array<{ readonly node: Text; readonly start: number; readonly end: number }> {
  const segments: Array<{ readonly node: Text; readonly start: number; readonly end: number }> = []
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    const text = current.textContent ?? ''
    const length = text.length
    segments.push({ node: current as Text, start: offset, end: offset + length })
    offset += length
    current = walker.nextNode()
  }
  return segments
}

function findAllMatches(text: string, exact: string): Array<{ readonly start: number; readonly end: number }> {
  const matches: Array<{ readonly start: number; readonly end: number }> = []
  let cursor = 0
  while (cursor <= text.length) {
    const index = text.indexOf(exact, cursor)
    if (index === -1) break
    matches.push({ start: index, end: index + exact.length })
    cursor = index + Math.max(1, exact.length)
  }
  return matches
}

function scoreMatch(
  renderedText: string,
  target: DriveAnnotationTextRangeTargetV1,
  range: { readonly start: number; readonly end: number },
): number {
  let score = 1
  if (target.quote.prefix) {
    const before = renderedText.slice(Math.max(0, range.start - target.quote.prefix.length), range.start)
    if (before === target.quote.prefix) score += 4
  }
  if (target.quote.suffix) {
    const after = renderedText.slice(range.end, range.end + target.quote.suffix.length)
    if (after === target.quote.suffix) score += 4
  }
  const distance = Math.abs(range.start - target.range.start)
  return score - Math.min(1, distance / Math.max(1, renderedText.length))
}

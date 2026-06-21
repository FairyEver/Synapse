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
  _pendingTarget?: DriveAnnotationTextRangeTargetV1 | null,
): MarkdownAnnotationHtmlResult {
  if (threads.length === 0) return { html, resolved: [] }
  const template = document.createElement('template')
  template.innerHTML = html
  const renderedText = getMarkdownRenderedText(template.content)
  const resolved = threads.map((thread) => ({
    threadId: thread.id,
    ...resolveMarkdownAnnotationTextRange(thread.target, renderedText),
  }))

  return { html, resolved }
}

export function resolveMarkdownAnnotationTextRange(
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

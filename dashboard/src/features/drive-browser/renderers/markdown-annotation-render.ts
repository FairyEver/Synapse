import type {
  DriveAnnotationCrdtRangeSelector,
  DriveAnnotationPositionStatus,
  DriveAnnotationQuoteStatus,
  DriveAnnotationAnchorStatus,
  DriveAnnotationTextRangeTargetV1,
  DriveAnnotationTextPositionSelector,
  DriveAnnotationThreadDto,
  DriveMarkdownProjectionDto,
} from '@synapse/shared'
import { resolveDriveAnnotationAnchor } from '@synapse/shared'
import { getMarkdownRenderedText } from './markdown-annotation-target'

export type MarkdownAnnotationResolvedRange = {
  readonly threadId: string
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly range: { readonly start: number; readonly end: number } | null
  readonly positionStatus?: DriveAnnotationPositionStatus
  readonly quoteStatus?: DriveAnnotationQuoteStatus
  readonly sourceRange?: DriveAnnotationTextPositionSelector | null
  readonly confidence?: number
}

export type MarkdownAnnotationLiveDocument = {
  readonly sourceText: string
  readonly projection: DriveMarkdownProjectionDto
  readonly resolveCrdtRange: (selector: DriveAnnotationCrdtRangeSelector) => DriveAnnotationTextPositionSelector | null
}

export type MarkdownAnnotationHtmlResult = {
  readonly html: string
  readonly resolved: readonly MarkdownAnnotationResolvedRange[]
}

export function renderMarkdownAnnotationHtml(
  html: string,
  threads: readonly DriveAnnotationThreadDto[],
  currentVersionId: string | null = null,
  liveDocument: MarkdownAnnotationLiveDocument | null = null,
): MarkdownAnnotationHtmlResult {
  if (threads.length === 0) return { html, resolved: [] }
  const template = document.createElement('template')
  template.innerHTML = html
  const renderedText = getMarkdownRenderedText(template.content)
  const resolved = threads.map((thread) => {
    if (thread.anchor) {
      if (liveDocument) {
        const resolution = resolveDriveAnnotationAnchor({
          selectors: thread.anchor.selectors,
          projection: liveDocument.projection,
          sourceText: liveDocument.sourceText,
          renderedText,
          crdtSourceRange: thread.anchor.selectors.crdt
            ? liveDocument.resolveCrdtRange(thread.anchor.selectors.crdt)
            : null,
        })
        return {
          threadId: thread.id,
          anchorStatus: resolution.positionStatus === 'attached' ? 'attached' as const : 'orphaned' as const,
          range: resolution.positionStatus === 'attached' ? resolution.renderedRange : null,
          positionStatus: resolution.positionStatus,
          quoteStatus: resolution.quoteStatus,
          sourceRange: resolution.sourceRange,
          confidence: resolution.confidence,
        }
      }
      return {
        threadId: thread.id,
        anchorStatus: thread.anchor.positionStatus === 'attached' && thread.anchor.resolvedRenderedRange ? 'attached' as const : 'orphaned' as const,
        range: thread.anchor.positionStatus === 'attached' ? thread.anchor.resolvedRenderedRange : null,
        positionStatus: thread.anchor.positionStatus,
        quoteStatus: thread.anchor.quoteStatus,
        sourceRange: thread.anchor.resolvedSourceRange,
        confidence: thread.anchor.confidence ?? undefined,
      }
    }
    return {
      threadId: thread.id,
      ...resolveMarkdownAnnotationTextRange(thread.target, renderedText, thread.baseVersionId === currentVersionId),
    }
  })

  return { html, resolved }
}

export function resolveMarkdownAnnotationTextRange(
  target: DriveAnnotationTextRangeTargetV1,
  renderedText: string,
  sameVersion = true,
): Omit<MarkdownAnnotationResolvedRange, 'threadId'> {
  const direct = renderedText.slice(target.range.start, target.range.end)
  if (sameVersion && direct === target.quote.exact) return { anchorStatus: 'attached', range: target.range }

  const matches = findAllMatches(renderedText, target.quote.exact)
  if (matches.length === 0) return { anchorStatus: 'orphaned', range: null }
  if (matches.length === 1) {
    const range = matches[0]
    return {
      anchorStatus: range.start === target.range.start && range.end === target.range.end ? 'attached' : 'shifted',
      range,
    }
  }

  const scored = matches
    .map((range) => ({ range, ...scoreMatch(renderedText, target, range) }))
    .sort((a, b) => b.contextScore - a.contextScore || a.distance - b.distance)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.contextScore === 0) return { anchorStatus: 'orphaned', range: null }
  if (second && second.contextScore === best.contextScore && second.distance === best.distance) {
    return { anchorStatus: 'orphaned', range: null }
  }
  return {
    anchorStatus: best.range.start === target.range.start && best.range.end === target.range.end ? 'attached' : 'shifted',
    range: best.range,
  }
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
): { readonly contextScore: number; readonly distance: number } {
  let contextScore = 0
  if (target.quote.prefix) {
    const before = renderedText.slice(Math.max(0, range.start - target.quote.prefix.length), range.start)
    if (before === target.quote.prefix) contextScore += 1
  }
  if (target.quote.suffix) {
    const after = renderedText.slice(range.end, range.end + target.quote.suffix.length)
    if (after === target.quote.suffix) contextScore += 1
  }
  return { contextScore, distance: Math.abs(range.start - target.range.start) }
}

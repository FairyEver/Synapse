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
import { resolveDriveAnnotationAnchor, resolveDriveImageAnnotationAnchor } from '@synapse/shared'
import { getMarkdownRenderedText } from './markdown-rendered-text'

export type MarkdownAnnotationResolvedRange = {
  readonly threadId: string
  readonly imageId?: string | null
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly range: { readonly start: number; readonly end: number } | null
  readonly renderedRange?: { readonly start: number; readonly end: number } | null
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
  currentProjection: DriveMarkdownProjectionDto | null = null,
): MarkdownAnnotationHtmlResult {
  if (threads.length === 0) return { html, resolved: [] }
  const template = document.createElement('template')
  template.innerHTML = html
  const renderedText = getMarkdownRenderedText(template.content)
  let utf16Offsets: readonly number[] | null = null
  let imageIds: Set<string | undefined> | null = null
  const toUtf16Range = (range: { readonly start: number; readonly end: number }) => {
    utf16Offsets ??= codePointUtf16Offsets(renderedText)
    return {
      start: codePointOffsetToUtf16(utf16Offsets, range.start),
      end: codePointOffsetToUtf16(utf16Offsets, range.end),
    }
  }
  const resolved = threads.map((thread) => {
    const refreshedSourceRange = thread.anchor?.resolvedSourceRange ?? null
    if (thread.target.kind === 'image') {
      const targetImageId = thread.target.imageId
      const imageProjection = liveDocument?.projection ?? currentProjection
      if (thread.anchor?.selectors.kind === 'image' && imageProjection) {
        const resolution = resolveDriveImageAnnotationAnchor({
          selectors: thread.anchor.selectors,
          projection: imageProjection,
          crdtSourceRange: liveDocument && thread.anchor.selectors.crdt
            ? liveDocument.resolveCrdtRange(thread.anchor.selectors.crdt)
            : thread.anchor.resolvedSourceRange,
          diffSourceRange: liveDocument ? refreshedSourceRange : null,
        })
        const currentImageId = resolution.sourceRange
          ? imageProjection.images?.find((image) => image.sourceStart === resolution.sourceRange?.start
            && image.sourceEnd === resolution.sourceRange?.end)?.imageId ?? null
          : null
        return {
          threadId: thread.id,
          imageId: currentImageId,
          anchorStatus: resolution.positionStatus === 'attached' && currentImageId ? 'attached' as const : 'orphaned' as const,
          range: null,
          renderedRange: null,
          positionStatus: resolution.positionStatus,
          quoteStatus: resolution.quoteStatus,
          sourceRange: resolution.sourceRange,
          confidence: resolution.confidence,
        }
      }
      imageIds ??= new Set(Array.from(
        template.content.querySelectorAll<HTMLElement>('[data-drive-markdown-image-id]'),
        (element) => element.dataset.driveMarkdownImageId,
      ))
      const attached = thread.anchorStatus !== 'orphaned'
        && thread.anchor?.positionStatus === 'attached'
        && imageIds.has(targetImageId)
      return {
        threadId: thread.id,
        imageId: attached ? targetImageId : null,
        anchorStatus: attached ? 'attached' as const : 'orphaned' as const,
        range: null,
        renderedRange: null,
        positionStatus: attached ? 'attached' as const : thread.anchor?.positionStatus ?? 'orphaned' as const,
        quoteStatus: attached ? 'exact' as const : 'deleted' as const,
        sourceRange: attached ? thread.anchor?.resolvedSourceRange ?? null : null,
        confidence: thread.anchor?.confidence ?? undefined,
      }
    }
    if (thread.anchor) {
      if (thread.anchor.selectors.kind === 'image') {
        return { threadId: thread.id, anchorStatus: 'orphaned' as const, range: null }
      }
      if (liveDocument) {
        const resolution = resolveDriveAnnotationAnchor({
          selectors: thread.anchor.selectors,
          projection: liveDocument.projection,
          sourceText: liveDocument.sourceText,
          renderedText,
          crdtSourceRange: thread.anchor.selectors.crdt
            ? liveDocument.resolveCrdtRange(thread.anchor.selectors.crdt)
            : null,
          diffSourceRange: refreshedSourceRange,
        })
        return {
          threadId: thread.id,
          anchorStatus: resolution.positionStatus === 'attached' ? 'attached' as const : 'orphaned' as const,
          range: resolution.positionStatus === 'attached' && resolution.renderedRange
            ? toUtf16Range(resolution.renderedRange)
            : null,
          renderedRange: resolution.renderedRange,
          positionStatus: resolution.positionStatus,
          quoteStatus: resolution.quoteStatus,
          sourceRange: resolution.sourceRange,
          confidence: resolution.confidence,
        }
      }
      const cachedRange = thread.anchor.resolvedRenderedRange
      const cachedUtf16Range = cachedRange ? toUtf16Range(cachedRange) : null
      const exactRangeMatches = thread.anchor.quoteStatus !== 'exact'
        || Boolean(cachedUtf16Range && renderedText.slice(cachedUtf16Range.start, cachedUtf16Range.end) === thread.anchor.selectors.quote.exact)
      const positionStatus = exactRangeMatches ? thread.anchor.positionStatus : 'orphaned' as const
      return {
        threadId: thread.id,
        anchorStatus: positionStatus === 'attached' && cachedRange ? 'attached' as const : 'orphaned' as const,
        range: positionStatus === 'attached' && cachedUtf16Range
          ? cachedUtf16Range
          : null,
        renderedRange: exactRangeMatches ? cachedRange : null,
        positionStatus,
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

function codePointUtf16Offsets(value: string): readonly number[] {
  const offsets = [0]
  let offset = 0
  for (const codePoint of value) {
    offset += codePoint.length
    offsets.push(offset)
  }
  return offsets
}

function codePointOffsetToUtf16(offsets: readonly number[], offset: number): number {
  const length = offsets.length - 1
  const index = Math.trunc(offset) || 0
  return offsets[index < 0 ? Math.max(0, length + index) : Math.min(index, length)]!
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

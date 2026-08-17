import type {
  DriveAnnotationImageSelectorsV2,
  DriveAnnotationPositionStatus,
  DriveAnnotationQuoteStatus,
  DriveAnnotationTextSelectorsV2,
  DriveAnnotationTextPositionSelector,
  DriveMarkdownProjectionDto,
} from "./drive.js"

export interface DriveAnnotationAnchorResolution {
  readonly positionStatus: DriveAnnotationPositionStatus
  readonly quoteStatus: DriveAnnotationQuoteStatus
  readonly sourceRange: DriveAnnotationTextPositionSelector | null
  readonly renderedRange: DriveAnnotationTextPositionSelector | null
  readonly confidence: number
}

export function resolveDriveAnnotationAnchor(input: {
  readonly selectors: DriveAnnotationTextSelectorsV2
  readonly projection: DriveMarkdownProjectionDto | null
  readonly sourceText: string
  readonly renderedText: string
  readonly crdtSourceRange?: DriveAnnotationTextPositionSelector | null
  readonly diffSourceRange?: DriveAnnotationTextPositionSelector | null
}): DriveAnnotationAnchorResolution {
  if (!input.projection) return unavailableResolution()
  const exact = input.selectors.quote.exact

  const crdtRangeCollapsed = Boolean(input.crdtSourceRange
    && input.crdtSourceRange.start === input.crdtSourceRange.end)

  const crdtCandidate = input.crdtSourceRange && !crdtRangeCollapsed
    ? sourceToRenderedCandidate(input.projection, input.crdtSourceRange)
    : null
  let relationshipIndicatesDeletion = crdtRangeCollapsed
  if (crdtCandidate) {
    const crdtResolution = classifyCandidate(input, crdtCandidate, 1, true)
    if (crdtResolution?.positionStatus === "attached") return crdtResolution
    relationshipIndicatesDeletion = true
  }

  const semanticCandidate = semanticCandidateRange(input.selectors, input.projection)
  if (semanticCandidate) {
    const semanticResolution = classifyCandidate(input, semanticCandidate, 0.97, false)
    if (semanticResolution) return semanticResolution
  }

  const diffCandidate = input.diffSourceRange
    ? sourceToRenderedCandidate(input.projection, input.diffSourceRange)
    : null
  if (diffCandidate) {
    const diffResolution = classifyCandidate(input, diffCandidate, 0.92, true)
    if (diffResolution?.positionStatus === "attached") return diffResolution
    relationshipIndicatesDeletion = true
  }

  const exactMatches = findAllCodePointMatches(input.renderedText, exact)
  if (exactMatches.length === 1) {
    return withSourceRange(input.projection, exactMatches[0], "attached", "exact", 0.9)
  }
  if (exactMatches.length > 1) {
    const ranked = exactMatches
      .map((range) => ({ range, score: scoreQuoteCandidate(input, range) }))
      .sort((left, right) => right.score - left.score)
    const best = ranked[0]
    const second = ranked[1]
    if (best && best.score >= 4 && (!second || best.score - second.score >= 2)) {
      return withSourceRange(input.projection, best.range, "attached", "exact", Math.min(0.89, 0.72 + best.score / 40))
    }
    return {
      positionStatus: "ambiguous",
      quoteStatus: "exact",
      sourceRange: null,
      renderedRange: null,
      confidence: 0,
    }
  }

  const contextualMatches = contextualCandidateRanges(input)
    .map((range) => ({ range, score: scoreQuoteCandidate(input, range) }))
    .sort((left, right) => right.score - left.score)
  const contextualBest = contextualMatches[0]
  const contextualSecond = contextualMatches[1]
  if (contextualBest && contextualBest.score >= 10
    && (!contextualSecond || contextualBest.score - contextualSecond.score >= 2)) {
    const sourceRange = renderedToSourceRange(input.projection, contextualBest.range)
    if (sourceRange) {
      const resolution = classifyCandidate(input, { sourceRange, renderedRange: contextualBest.range }, 0.82, false)
      if (resolution) return resolution
    }
  }
  if (contextualMatches.length > 1) {
    return {
      positionStatus: "ambiguous",
      quoteStatus: "modified",
      sourceRange: null,
      renderedRange: null,
      confidence: 0,
    }
  }

  return {
    positionStatus: relationshipIndicatesDeletion ? "source_deleted" : "orphaned",
    quoteStatus: "deleted",
    sourceRange: null,
    renderedRange: null,
    confidence: 0,
  }
}

export function resolveDriveImageAnnotationAnchor(input: {
  readonly selectors: DriveAnnotationImageSelectorsV2
  readonly projection: DriveMarkdownProjectionDto | null
  readonly crdtSourceRange?: DriveAnnotationTextPositionSelector | null
  readonly diffSourceRange?: DriveAnnotationTextPositionSelector | null
}): DriveAnnotationAnchorResolution {
  const images = input.projection?.images
  if (!input.projection || !images) return unavailableResolution()
  const resourceKey = input.selectors.identity.resourceKey

  const positionedCandidates = [input.selectors.position, input.crdtSourceRange, input.diffSourceRange]
  for (const range of positionedCandidates) {
    if (!range) continue
    const match = images.find((image) => image.sourceStart === range.start
      && image.sourceEnd === range.end
      && image.resourceKey === resourceKey)
    if (match) return attachedImageResolution(match.sourceStart, match.sourceEnd, range === input.selectors.position ? 1 : 0.96)
  }

  const semanticMatch = images.find((image) => image.blockId === input.selectors.semantic.blockId
    && image.imageIndex === input.selectors.semantic.imageIndex
    && image.resourceKey === resourceKey)
  if (semanticMatch) return attachedImageResolution(semanticMatch.sourceStart, semanticMatch.sourceEnd, 0.92)

  const identityMatches = images.filter((image) => image.resourceKey === resourceKey)
  if (identityMatches.length === 1) {
    const match = identityMatches[0]
    return attachedImageResolution(match.sourceStart, match.sourceEnd, 0.86)
  }
  if (identityMatches.length > 1) {
    return {
      positionStatus: "ambiguous",
      quoteStatus: "deleted",
      sourceRange: null,
      renderedRange: null,
      confidence: 0,
    }
  }
  return {
    positionStatus: "orphaned",
    quoteStatus: "deleted",
    sourceRange: null,
    renderedRange: null,
    confidence: 0,
  }
}

function attachedImageResolution(start: number, end: number, confidence: number): DriveAnnotationAnchorResolution {
  return {
    positionStatus: "attached",
    quoteStatus: "exact",
    sourceRange: { start, end },
    renderedRange: null,
    confidence,
  }
}

function contextualCandidateRanges(
  input: Parameters<typeof resolveDriveAnnotationAnchor>[0],
): DriveAnnotationTextPositionSelector[] {
  const { prefix, suffix, exact } = input.selectors.quote
  if (!prefix && !suffix) return []
  const text = Array.from(input.renderedText)
  const exactLength = codePointCount(exact)
  const maximumCandidateLength = Math.max(exactLength * 4, exactLength + 256)
  const prefixMatches = prefix ? findAllCodePointMatches(input.renderedText, prefix) : []
  const suffixMatches = suffix ? findAllCodePointMatches(input.renderedText, suffix) : []
  const candidates: DriveAnnotationTextPositionSelector[] = []

  if (prefix && suffix) {
    for (const prefixMatch of prefixMatches) {
      for (const suffixMatch of suffixMatches) {
        const length = suffixMatch.start - prefixMatch.end
        if (length > 0 && length <= maximumCandidateLength) {
          candidates.push({ start: prefixMatch.end, end: suffixMatch.start })
        }
      }
    }
    return candidates
  }

  if (prefix) {
    for (const prefixMatch of prefixMatches) {
      const end = Math.min(text.length, prefixMatch.end + exactLength)
      if (end > prefixMatch.end) candidates.push({ start: prefixMatch.end, end })
    }
  } else {
    for (const suffixMatch of suffixMatches) {
      const start = Math.max(0, suffixMatch.start - exactLength)
      if (suffixMatch.start > start) candidates.push({ start, end: suffixMatch.start })
    }
  }
  return candidates
}

export function sliceByCodePoints(value: string, start: number, end?: number): string {
  return Array.from(value).slice(start, end).join("")
}

export function codePointCount(value: string): number {
  return Array.from(value).length
}

function classifyCandidate(
  input: Parameters<typeof resolveDriveAnnotationAnchor>[0],
  candidate: { readonly sourceRange: DriveAnnotationTextPositionSelector; readonly renderedRange: DriveAnnotationTextPositionSelector },
  confidence: number,
  allowRelationshipEvidence: boolean,
): DriveAnnotationAnchorResolution | null {
  const selected = sliceByCodePoints(input.renderedText, candidate.renderedRange.start, candidate.renderedRange.end)
  if (selected === input.selectors.quote.exact) {
    return { positionStatus: "attached", quoteStatus: "exact", ...candidate, confidence }
  }
  const similarity = quoteSimilarity(selected, input.selectors.quote.exact)
  if (candidate.renderedRange.end > candidate.renderedRange.start
    && (similarity >= 0.35 || preservesQuoteContext(input, candidate.renderedRange))) {
    return { positionStatus: "attached", quoteStatus: "modified", ...candidate, confidence: Math.min(confidence, 0.86) }
  }
  if (allowRelationshipEvidence) return {
    positionStatus: "source_deleted",
    quoteStatus: "deleted",
    sourceRange: null,
    renderedRange: null,
    confidence: 0,
  }
  return null
}

function quoteSimilarity(left: string, right: string): number {
  const leftPoints = Array.from(left)
  const rightPoints = Array.from(right)
  const denominator = Math.max(leftPoints.length, rightPoints.length)
  if (denominator === 0) return 1
  let prefix = 0
  while (prefix < Math.min(leftPoints.length, rightPoints.length) && leftPoints[prefix] === rightPoints[prefix]) prefix += 1
  let suffix = 0
  while (suffix < Math.min(leftPoints.length, rightPoints.length) - prefix
    && leftPoints[leftPoints.length - 1 - suffix] === rightPoints[rightPoints.length - 1 - suffix]) suffix += 1
  return (prefix + suffix) / denominator
}

function preservesQuoteContext(
  input: Parameters<typeof resolveDriveAnnotationAnchor>[0],
  range: DriveAnnotationTextPositionSelector,
): boolean {
  const { prefix, suffix } = input.selectors.quote
  if (!prefix && !suffix) return false
  const prefixMatches = !prefix || sliceByCodePoints(input.renderedText, Math.max(0, range.start - codePointCount(prefix)), range.start) === prefix
  const suffixMatches = !suffix || sliceByCodePoints(input.renderedText, range.end, range.end + codePointCount(suffix)) === suffix
  return prefixMatches && suffixMatches
}

function semanticCandidateRange(
  selectors: DriveAnnotationTextSelectorsV2,
  projection: DriveMarkdownProjectionDto,
): { readonly sourceRange: DriveAnnotationTextPositionSelector; readonly renderedRange: DriveAnnotationTextPositionSelector } | null {
  const semantic = selectors.semantic
  if (!semantic) return null
  const block = projection.blocks.find((candidate) => candidate.blockId === semantic.blockId)
  if (!block) return null
  const renderedRange = {
    start: block.renderedStart + semantic.start,
    end: block.renderedStart + semantic.end,
  }
  if (renderedRange.start < block.renderedStart || renderedRange.end > block.renderedEnd || renderedRange.end < renderedRange.start) return null
  const sourceRange = renderedToSourceRange(projection, renderedRange)
  return sourceRange ? { sourceRange, renderedRange } : null
}

function sourceToRenderedCandidate(
  projection: DriveMarkdownProjectionDto,
  sourceRange: DriveAnnotationTextPositionSelector,
): { readonly sourceRange: DriveAnnotationTextPositionSelector; readonly renderedRange: DriveAnnotationTextPositionSelector } | null {
  const first = projection.segments.find((segment) =>
    segment.mapping === "identity" && segment.sourceStart <= sourceRange.start && segment.sourceEnd > sourceRange.start)
  const last = [...projection.segments].reverse().find((segment) =>
    segment.mapping === "identity" && segment.sourceStart < sourceRange.end && segment.sourceEnd >= sourceRange.end)
  if (!first || !last) return null
  return {
    sourceRange,
    renderedRange: {
      start: first.renderedStart + (sourceRange.start - first.sourceStart),
      end: last.renderedStart + (sourceRange.end - last.sourceStart),
    },
  }
}

function renderedToSourceRange(
  projection: DriveMarkdownProjectionDto,
  renderedRange: DriveAnnotationTextPositionSelector,
): DriveAnnotationTextPositionSelector | null {
  const overlapping = projection.segments.filter((segment) =>
    segment.renderedEnd > renderedRange.start && segment.renderedStart < renderedRange.end)
  if (overlapping.length === 0) return null
  const first = overlapping[0]
  const last = overlapping[overlapping.length - 1]
  return {
    start: first.mapping === "identity"
      ? first.sourceStart + Math.max(0, renderedRange.start - first.renderedStart)
      : first.sourceStart,
    end: last.mapping === "identity"
      ? last.sourceStart + Math.max(0, renderedRange.end - last.renderedStart)
      : last.sourceEnd,
  }
}

function withSourceRange(
  projection: DriveMarkdownProjectionDto,
  renderedRange: DriveAnnotationTextPositionSelector,
  positionStatus: DriveAnnotationPositionStatus,
  quoteStatus: DriveAnnotationQuoteStatus,
  confidence: number,
): DriveAnnotationAnchorResolution {
  return {
    positionStatus,
    quoteStatus,
    sourceRange: renderedToSourceRange(projection, renderedRange),
    renderedRange,
    confidence,
  }
}

function scoreQuoteCandidate(
  input: Parameters<typeof resolveDriveAnnotationAnchor>[0],
  range: DriveAnnotationTextPositionSelector,
): number {
  let score = 0
  const prefix = input.selectors.quote.prefix
  const suffix = input.selectors.quote.suffix
  if (prefix) {
    const before = sliceByCodePoints(input.renderedText, Math.max(0, range.start - codePointCount(prefix)), range.start)
    if (before === prefix) score += 6
  }
  if (suffix) {
    const after = sliceByCodePoints(input.renderedText, range.end, range.end + codePointCount(suffix))
    if (after === suffix) score += 6
  }
  const block = input.projection?.blocks.find((candidate) => candidate.renderedStart <= range.start && candidate.renderedEnd >= range.end)
  if (block && input.selectors.semantic?.blockType === block.type) score += 2
  if (block && sameTextArray(input.selectors.semantic?.headingPath ?? [], block.headingPath)) score += 3
  const origin = input.selectors.renderedPosition?.start ?? input.selectors.position.start
  const distance = Math.abs(range.start - origin)
  score += Math.max(0, 2 - distance / Math.max(1, codePointCount(input.renderedText)))
  return score
}

function findAllCodePointMatches(value: string, exact: string): DriveAnnotationTextPositionSelector[] {
  if (!exact) return []
  const valuePoints = Array.from(value)
  const exactPoints = Array.from(exact)
  const matches: DriveAnnotationTextPositionSelector[] = []
  for (let start = 0; start <= valuePoints.length - exactPoints.length; start += 1) {
    if (exactPoints.every((point, index) => valuePoints[start + index] === point)) {
      matches.push({ start, end: start + exactPoints.length })
    }
  }
  return matches
}

function sameTextArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function unavailableResolution(): DriveAnnotationAnchorResolution {
  return {
    positionStatus: "unavailable",
    quoteStatus: "exact",
    sourceRange: null,
    renderedRange: null,
    confidence: 0,
  }
}

import {
  DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH,
  codePointCount,
  sliceByCodePoints,
  type DriveAnnotationSelectorsV2,
  type DriveAnnotationImageTargetV1,
  type DriveMarkdownProjectionImageDto,
  type DriveAnnotationTextRangeTargetV1,
  type DriveMarkdownProjectionDto,
} from '@synapse/shared'
import * as Y from 'yjs'
import {
  getMarkdownRangeRenderedText,
  getMarkdownRenderedText,
} from './markdown-rendered-text'

export { getMarkdownRenderedText } from './markdown-rendered-text'

const CONTEXT_LENGTH = 80

export function createMarkdownAnnotationTargetFromSelection(
  root: HTMLElement,
  selection: Selection | null,
): DriveAnnotationTextRangeTargetV1 | null {
  return createMarkdownAnnotationSelectionSnapshot(root, selection)?.target ?? null
}

function createMarkdownAnnotationSelectionSnapshot(
  root: HTMLElement,
  selection: Selection | null,
  projection?: DriveMarkdownProjectionDto | null,
): {
  readonly target: DriveAnnotationTextRangeTargetV1
  readonly renderedText: string
} | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!rootContainsRange(root, range)) return null

  const exact = getMarkdownRangeRenderedText(range, projection)
  if (!exact.trim()) return null
  if (exact.length > DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH) return null

  const beforeRange = document.createRange()
  beforeRange.selectNodeContents(root)
  beforeRange.setEnd(range.startContainer, range.startOffset)
  const start = getMarkdownRangeRenderedText(beforeRange, projection).length
  beforeRange.detach()

  const end = start + exact.length
  const renderedText = getMarkdownRenderedText(root, projection)
  return {
    renderedText,
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range: { start, end },
      quote: {
        exact,
        prefix: renderedText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
        suffix: renderedText.slice(end, end + CONTEXT_LENGTH),
      },
    },
  }
}

export function createMarkdownAnnotationAnchorFromSelection(input: {
  readonly root: HTMLElement
  readonly selection: Selection | null
  readonly projection: DriveMarkdownProjectionDto | null | undefined
  readonly epoch?: string | null
  readonly yText?: Y.Text | null
}): { readonly target: DriveAnnotationTextRangeTargetV1; readonly selectors: DriveAnnotationSelectorsV2 } | null {
  const snapshot = createMarkdownAnnotationSelectionSnapshot(input.root, input.selection, input.projection)
  if (!snapshot) return null
  const { renderedText, target } = snapshot
  if (!hasGraphemeBoundaries(renderedText, target.range.start, target.range.end)) return null
  const renderedPosition = {
    start: codePointCount(renderedText.slice(0, target.range.start)),
    end: codePointCount(renderedText.slice(0, target.range.end)),
  }
  if (!input.projection) {
    return {
      target,
      selectors: {
        schemaVersion: 2,
        position: renderedPosition,
        renderedPosition,
        quote: {
          exact: target.quote.exact,
          prefix: sliceByCodePoints(renderedText, Math.max(0, renderedPosition.start - CONTEXT_LENGTH), renderedPosition.start),
          suffix: sliceByCodePoints(renderedText, renderedPosition.end, renderedPosition.end + CONTEXT_LENGTH),
        },
      },
    }
  }
  const segments = input.projection.segments.filter((segment) =>
    segment.renderedEnd > renderedPosition.start && segment.renderedStart < renderedPosition.end)
  if (segments.length === 0) return null
  const firstSegment = segments[0]
  const lastSegment = segments[segments.length - 1]
  const position = {
    start: firstSegment.mapping === 'identity'
      ? firstSegment.sourceStart + Math.max(0, renderedPosition.start - firstSegment.renderedStart)
      : firstSegment.sourceStart,
    end: lastSegment.mapping === 'identity'
      ? lastSegment.sourceStart + Math.max(0, renderedPosition.end - lastSegment.renderedStart)
      : lastSegment.sourceEnd,
  }
  const block = [...input.projection.blocks]
    .filter((candidate) => candidate.renderedStart <= renderedPosition.start && candidate.renderedEnd >= renderedPosition.end)
    .sort((left, right) => (left.renderedEnd - left.renderedStart) - (right.renderedEnd - right.renderedStart))[0]
  const prefixStart = Math.max(0, renderedPosition.start - CONTEXT_LENGTH)
  const quote = {
    exact: target.quote.exact,
    prefix: sliceByCodePoints(renderedText, prefixStart, renderedPosition.start),
    suffix: sliceByCodePoints(renderedText, renderedPosition.end, renderedPosition.end + CONTEXT_LENGTH),
  }
  const crdt = input.yText?.doc && input.epoch
    ? {
        epoch: input.epoch,
        start: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(input.yText, codePointOffsetToUtf16(input.yText.toString(), position.start))),
        end: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(input.yText, codePointOffsetToUtf16(input.yText.toString(), position.end))),
      }
    : undefined
  return {
    target,
    selectors: {
      schemaVersion: 2,
      ...(crdt ? { crdt } : {}),
      ...(block ? {
        semantic: {
          blockId: block.blockId,
          start: renderedPosition.start - block.renderedStart,
          end: renderedPosition.end - block.renderedStart,
          blockType: block.type,
          headingPath: block.headingPath,
        },
      } : {}),
      position,
      renderedPosition,
      quote,
    },
  }
}

export function createMarkdownImageAnnotationAnchor(input: {
  readonly image: DriveMarkdownProjectionImageDto
  readonly projection: DriveMarkdownProjectionDto
  readonly epoch?: string | null
  readonly yText?: Y.Text | null
}): { readonly target: DriveAnnotationImageTargetV1; readonly selectors: DriveAnnotationSelectorsV2 } {
  const block = input.projection.blocks.find((candidate) => candidate.blockId === input.image.blockId)
  const semantic = {
    blockId: input.image.blockId,
    imageIndex: input.image.imageIndex,
    headingPath: block?.headingPath ?? [],
  }
  const crdt = input.yText?.doc && input.epoch
    ? {
        epoch: input.epoch,
        start: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(
          input.yText,
          codePointOffsetToUtf16(input.yText.toString(), input.image.sourceStart),
        )),
        end: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(
          input.yText,
          codePointOffsetToUtf16(input.yText.toString(), input.image.sourceEnd),
        )),
      }
    : undefined
  return {
    target: {
      schemaVersion: 1,
      kind: 'image',
      surface: 'markdownRenderedImage',
      imageId: input.image.imageId,
      resourceKey: input.image.resourceKey,
      source: { startOffset: input.image.sourceStart, endOffset: input.image.sourceEnd },
      snapshot: { src: input.image.source, alt: input.image.alt, title: input.image.title },
      blockHint: {
        ...semantic,
        blockIndex: Math.max(0, input.projection.blocks.findIndex((candidate) => candidate.blockId === input.image.blockId)),
      },
    },
    selectors: {
      schemaVersion: 2,
      kind: 'image',
      ...(crdt ? { crdt } : {}),
      position: { start: input.image.sourceStart, end: input.image.sourceEnd },
      semantic,
      identity: { imageId: input.image.imageId, resourceKey: input.image.resourceKey },
    },
  }
}

function rootContainsRange(root: HTMLElement, range: Range): boolean {
  return rootContainsNode(root, range.startContainer)
    && rootContainsNode(root, range.endContainer)
    && rootContainsNode(root, range.commonAncestorContainer)
}

function rootContainsNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node)
}

function hasGraphemeBoundaries(value: string, startUtf16: number, endUtf16: number): boolean {
  const Segmenter = (Intl as typeof Intl & {
    readonly Segmenter?: new (
      locale?: string,
      options?: { readonly granularity: 'grapheme' }
    ) => { segment: (input: string) => Iterable<{ readonly index: number }> }
  }).Segmenter
  if (!Segmenter) return true
  let hasStart = startUtf16 === 0 || startUtf16 === value.length
  let hasEnd = endUtf16 === 0 || endUtf16 === value.length
  if (hasStart && hasEnd) return true
  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
  for (const segment of segmenter.segment(value)) {
    if (segment.index === startUtf16) hasStart = true
    if (segment.index === endUtf16) hasEnd = true
    if (hasStart && hasEnd) return true
    if (segment.index > endUtf16) return false
  }
  return hasStart && hasEnd
}

function encodeRelativePosition(position: Y.RelativePosition): string {
  const bytes = Y.encodeRelativePosition(position)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0)
  return btoa(binary)
}

function codePointOffsetToUtf16(value: string, offset: number): number {
  return Array.from(value).slice(0, offset).join('').length
}

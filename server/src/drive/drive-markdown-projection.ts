import { createHash } from "node:crypto"
import type {
  DriveMarkdownProjectionBlockDto,
  DriveMarkdownProjectionDto,
  DriveMarkdownProjectionSegmentDto,
} from "@synapse/shared"
import { diffArrays } from "diff"
import type { DriveAnnotationTextPositionSelector } from "@synapse/shared"

export const DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION = 1
export const DRIVE_MARKDOWN_PARSER_VERSION = "remark-15-gfm-4"

type MarkdownPosition = {
  readonly start: { readonly offset?: number }
  readonly end: { readonly offset?: number }
}

export type MarkdownProjectionNode = {
  readonly type?: string
  readonly value?: unknown
  readonly alt?: unknown
  readonly depth?: unknown
  readonly position?: MarkdownPosition
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
  readonly children?: MarkdownProjectionNode[]
}

type ProjectionBuildOptions = {
  readonly previous?: {
    readonly source: string
    readonly projection: DriveMarkdownProjectionDto
  } | null
}

type MutableProjectionBlock = Omit<DriveMarkdownProjectionBlockDto, "blockId" | "parentBlockId"> & {
  blockId: string
  parentBlockIndex: number | null
}

const markdownBlockTypes = new Set([
  "heading",
  "paragraph",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "code",
  "thematicBreak",
])

const markdownSegmentTypes = new Set(["text", "inlineCode", "code", "image", "break"])

export function buildDriveMarkdownProjection(
  markdown: string,
  tree: MarkdownProjectionNode,
  options: ProjectionBuildOptions = {},
): DriveMarkdownProjectionDto {
  const sourceSha256 = sha256(markdown)
  const blocks: MutableProjectionBlock[] = []
  const segments: DriveMarkdownProjectionSegmentDto[] = []
  const utf16ToCodePoint = createUtf16ToCodePointMap(markdown)
  const headingStack: string[] = []
  let renderedCursor = 0

  const visit = (node: MarkdownProjectionNode, parentBlockIndex: number | null): void => {
    const type = node.type ?? "unknown"
    let currentParentBlockIndex = parentBlockIndex
    if (markdownBlockTypes.has(type) && hasOffsets(node)) {
      if (type === "heading") {
        const depth = typeof node.depth === "number" ? node.depth : 1
        headingStack.splice(Math.max(0, depth - 1))
        headingStack[depth - 1] = normalizedVisibleText(node)
      }
      const text = visibleText(node)
      const sourceStart = utf16ToCodePoint(node.position.start.offset ?? 0)
      const sourceEnd = utf16ToCodePoint(node.position.end.offset ?? 0)
      currentParentBlockIndex = blocks.length
      blocks.push({
        blockId: "",
        type,
        parentBlockIndex,
        headingPath: headingStack.filter(Boolean),
        sourceStart,
        sourceEnd,
        renderedStart: renderedCursor,
        renderedEnd: renderedCursor + codePointLength(text),
        textFingerprint: sha256(`${type}\0${normalizeText(text)}`),
      })
    }

    const children = node.children ?? []
    if (children.length > 0) {
      for (const child of children) visit(child, currentParentBlockIndex)
      return
    }

    if (!markdownSegmentTypes.has(type) || !hasOffsets(node)) return
    const text = visibleText(node)
    const renderedLength = codePointLength(text)
    if (renderedLength === 0 && type !== "break") return
    const blockIndex = currentParentBlockIndex ?? nearestContainingBlock(blocks, utf16ToCodePoint(node.position.start.offset ?? 0))
    if (blockIndex === null) return
    const block = blocks[blockIndex]
    const sourceStart = utf16ToCodePoint(node.position.start.offset ?? 0)
    const sourceEnd = utf16ToCodePoint(node.position.end.offset ?? 0)
    segments.push({
      segmentId: "",
      blockId: "",
      sourceStart,
      sourceEnd,
      renderedStart: renderedCursor,
      renderedEnd: renderedCursor + renderedLength,
      mapping: sourceEnd - sourceStart === renderedLength ? "identity" : type === "break" ? "generated" : "markdown_syntax",
    })
    renderedCursor += renderedLength
  }

  for (const child of tree.children ?? []) visit(child, null)
  inheritBlockIds(markdown, blocks, options.previous ?? null)

  const finalizedBlocks = blocks.map((block) => ({
    blockId: block.blockId,
    type: block.type,
    parentBlockId: block.parentBlockIndex === null ? null : blocks[block.parentBlockIndex]?.blockId ?? null,
    headingPath: block.headingPath,
    sourceStart: block.sourceStart,
    sourceEnd: block.sourceEnd,
    renderedStart: block.renderedStart,
    renderedEnd: block.renderedEnd,
    textFingerprint: block.textFingerprint,
  }))
  const finalizedSegments = segments.map((segment, index) => {
    const block = narrowestContainingBlock(finalizedBlocks, segment.sourceStart, segment.sourceEnd)
    const blockId = block?.blockId ?? finalizedBlocks[0]?.blockId ?? "mdb_root"
    return {
      ...segment,
      blockId,
      segmentId: `mds_${sha256(`${blockId}\0${segment.sourceStart}\0${segment.sourceEnd}\0${index}`).slice(0, 20)}`,
    }
  })

  return {
    schemaVersion: DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION,
    parserVersion: DRIVE_MARKDOWN_PARSER_VERSION,
    sourceSha256,
    blocks: finalizedBlocks,
    segments: finalizedSegments,
  }
}

export function annotateMarkdownProjectionTree(
  tree: MarkdownProjectionNode,
  projection: DriveMarkdownProjectionDto,
  markdown: string,
): void {
  const utf16ToCodePoint = createUtf16ToCodePointMap(markdown)
  const visit = (node: MarkdownProjectionNode): void => {
    if (hasOffsets(node)) {
      const sourceStart = utf16ToCodePoint(node.position.start.offset ?? 0)
      const sourceEnd = utf16ToCodePoint(node.position.end.offset ?? 0)
      const block = projection.blocks.find((candidate) => candidate.type === node.type && candidate.sourceStart === sourceStart && candidate.sourceEnd === sourceEnd)
      const segment = (node.children?.length ?? 0) === 0
        ? projection.segments.find((candidate) => candidate.sourceStart === sourceStart && candidate.sourceEnd === sourceEnd)
        : undefined
      if (block || segment) {
        node.data = {
          ...(node.data ?? {}),
          hProperties: {
            ...(node.data?.hProperties ?? {}),
            ...(block ? { "data-drive-markdown-block-id": block.blockId } : {}),
            ...(segment ? { "data-drive-markdown-segment-id": segment.segmentId } : {}),
          },
        }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
}

export function codePointLength(value: string): number {
  return Array.from(value).length
}

export function mapDriveMarkdownSourceRange(
  previousSource: string,
  nextSource: string,
  range: DriveAnnotationTextPositionSelector,
): DriveAnnotationTextPositionSelector | null {
  const previous = Array.from(previousSource)
  const next = Array.from(nextSource)
  if (range.start < 0 || range.end < range.start || range.end > previous.length) return null
  const changes = diffArrays(previous, next, { timeout: 75, maxEditLength: 8192 })
  if (!changes) return null
  const unchanged: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = []
  let oldCursor = 0
  let newCursor = 0
  for (const change of changes) {
    const length = change.value.length
    if (change.added) newCursor += length
    else if (change.removed) oldCursor += length
    else {
      unchanged.push({ oldStart: oldCursor, oldEnd: oldCursor + length, newStart: newCursor, newEnd: newCursor + length })
      oldCursor += length
      newCursor += length
    }
  }
  const mapStart = mapSourceBoundary(range.start, unchanged, next.length, "start")
  const mapEnd = mapSourceBoundary(range.end, unchanged, next.length, "end")
  return mapStart === null || mapEnd === null || mapEnd < mapStart ? null : { start: mapStart, end: mapEnd }
}

export function extractDriveMarkdownRenderedText(tree: MarkdownProjectionNode): string {
  const values: string[] = []
  const visit = (node: MarkdownProjectionNode): void => {
    const children = node.children ?? []
    if (children.length > 0) {
      for (const child of children) visit(child)
      return
    }
    if (!markdownSegmentTypes.has(node.type ?? "")) return
    values.push(visibleText(node))
  }
  visit(tree)
  return values.join("")
}

function inheritBlockIds(
  markdown: string,
  blocks: MutableProjectionBlock[],
  previous: ProjectionBuildOptions["previous"],
): void {
  const used = new Set<string>()
  const mappedPreviousRanges = previous ? mapPreviousBlockRanges(previous.source, markdown, previous.projection.blocks) : []
  for (const [index, block] of blocks.entries()) {
    const overlapCandidates = mappedPreviousRanges
      .filter((candidate) => candidate.block.type === block.type && !used.has(candidate.block.blockId))
      .map((candidate) => ({ candidate, overlap: overlapRatio(block, candidate) }))
      .filter(({ overlap }) => overlap >= 0.6)
      .sort((left, right) => right.overlap - left.overlap)
    const overlapWinner = overlapCandidates[0]
    if (overlapWinner && (!overlapCandidates[1] || overlapWinner.overlap > overlapCandidates[1].overlap)) {
      block.blockId = overlapWinner.candidate.block.blockId
      used.add(block.blockId)
      continue
    }

    const fingerprintCandidates = previous?.projection.blocks.filter((candidate) =>
      candidate.type === block.type
      && candidate.textFingerprint === block.textFingerprint
      && sameHeadingPath(candidate.headingPath, block.headingPath)
      && !used.has(candidate.blockId)) ?? []
    if (fingerprintCandidates.length === 1) {
      block.blockId = fingerprintCandidates[0].blockId
      used.add(block.blockId)
      continue
    }

    block.blockId = `mdb_${sha256(`${block.type}\0${block.textFingerprint}\0${block.sourceStart}\0${index}`).slice(0, 20)}`
    used.add(block.blockId)
  }
}

function mapPreviousBlockRanges(
  previousSource: string,
  nextSource: string,
  blocks: readonly DriveMarkdownProjectionBlockDto[],
): Array<{ readonly block: DriveMarkdownProjectionBlockDto; readonly sourceStart: number; readonly sourceEnd: number }> {
  const changes = diffArrays(Array.from(previousSource), Array.from(nextSource), { timeout: 75, maxEditLength: 8192 })
  if (!changes) return []
  const unchanged: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = []
  let oldCursor = 0
  let newCursor = 0
  for (const change of changes) {
    const length = change.value.length
    if (change.added) {
      newCursor += length
    } else if (change.removed) {
      oldCursor += length
    } else {
      unchanged.push({ oldStart: oldCursor, oldEnd: oldCursor + length, newStart: newCursor, newEnd: newCursor + length })
      oldCursor += length
      newCursor += length
    }
  }
  return blocks.flatMap((block) => {
    const startChunk = unchanged.find((chunk) => block.sourceStart >= chunk.oldStart && block.sourceStart <= chunk.oldEnd)
    const endChunk = unchanged.find((chunk) => block.sourceEnd >= chunk.oldStart && block.sourceEnd <= chunk.oldEnd)
    if (!startChunk || !endChunk) return []
    return [{
      block,
      sourceStart: startChunk.newStart + (block.sourceStart - startChunk.oldStart),
      sourceEnd: endChunk.newStart + (block.sourceEnd - endChunk.oldStart),
    }]
  })
}

function mapSourceBoundary(
  offset: number,
  unchanged: readonly { oldStart: number; oldEnd: number; newStart: number; newEnd: number }[],
  nextLength: number,
  affinity: "start" | "end",
): number | null {
  const containing = unchanged.find((chunk) => offset >= chunk.oldStart && offset <= chunk.oldEnd)
  if (containing) return containing.newStart + (offset - containing.oldStart)
  if (affinity === "start") {
    const previous = [...unchanged].reverse().find((chunk) => chunk.oldEnd <= offset)
    return previous?.newEnd ?? 0
  }
  const next = unchanged.find((chunk) => chunk.oldStart >= offset)
  return next?.newStart ?? nextLength
}

function overlapRatio(
  block: Pick<DriveMarkdownProjectionBlockDto, "sourceStart" | "sourceEnd">,
  candidate: { readonly sourceStart: number; readonly sourceEnd: number },
): number {
  const overlap = Math.max(0, Math.min(block.sourceEnd, candidate.sourceEnd) - Math.max(block.sourceStart, candidate.sourceStart))
  const denominator = Math.max(1, Math.max(block.sourceEnd - block.sourceStart, candidate.sourceEnd - candidate.sourceStart))
  return overlap / denominator
}

function nearestContainingBlock(blocks: readonly MutableProjectionBlock[], sourceStart: number): number | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.sourceStart <= sourceStart && block.sourceEnd >= sourceStart) return index
  }
  return null
}

function narrowestContainingBlock(
  blocks: readonly DriveMarkdownProjectionBlockDto[],
  sourceStart: number,
  sourceEnd: number,
): DriveMarkdownProjectionBlockDto | null {
  return blocks
    .filter((block) => block.sourceStart <= sourceStart && block.sourceEnd >= sourceEnd)
    .sort((left, right) => (left.sourceEnd - left.sourceStart) - (right.sourceEnd - right.sourceStart))[0] ?? null
}

function hasOffsets(node: MarkdownProjectionNode): node is MarkdownProjectionNode & { position: MarkdownPosition } {
  return typeof node.position?.start.offset === "number" && typeof node.position?.end.offset === "number"
}

function visibleText(node: MarkdownProjectionNode): string {
  if (node.type === "image" && typeof node.alt === "string") return node.alt
  if (node.type === "break") return "\n"
  if (typeof node.value === "string") return node.value
  return (node.children ?? []).map(visibleText).join("")
}

function normalizedVisibleText(node: MarkdownProjectionNode): string {
  return normalizeText(visibleText(node))
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim()
}

function sameHeadingPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function createUtf16ToCodePointMap(value: string): (offset: number) => number {
  const offsets = new Array<number>(value.length + 1)
  let utf16Cursor = 0
  let codePointCursor = 0
  offsets[0] = 0
  for (const character of value) {
    const width = character.length
    for (let index = 1; index <= width; index += 1) offsets[utf16Cursor + index] = codePointCursor + 1
    utf16Cursor += width
    codePointCursor += 1
  }
  return (offset) => offsets[Math.max(0, Math.min(value.length, offset))] ?? codePointCursor
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

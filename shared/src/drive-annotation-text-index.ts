import type { DriveAnnotationTextPositionSelector, DriveMarkdownProjectionDto } from './drive.js'

type Block = DriveMarkdownProjectionDto['blocks'][number]
const indexes = new WeakMap<DriveMarkdownProjectionDto, DriveAnnotationTextIndex>()

/** Shared by anchors using the same immutable projection and rendered text. */
export function getDriveAnnotationTextIndex(text: string, projection: DriveMarkdownProjectionDto | null): DriveAnnotationTextIndex {
  const cached = projection ? indexes.get(projection) : undefined
  if (cached?.text === text) return cached
  const index = new DriveAnnotationTextIndex(text, projection)
  if (projection) indexes.set(projection, index)
  return index
}

class DriveAnnotationTextIndex {
  readonly length: number
  private readonly offsets: Uint32Array
  private readonly blocksById = new Map<string, Block>()
  private readonly blocks: Array<{ block: Block; order: number; maximumEnd: number }>

  constructor(readonly text: string, projection: DriveMarkdownProjectionDto | null) {
    this.offsets = new Uint32Array(text.length + 1)
    let count = 0
    let offset = 0
    for (const point of text) {
      this.offsets[count++] = offset
      offset += point.length
    }
    this.offsets[count] = text.length
    this.length = count
    this.blocks = (projection?.blocks ?? []).map((block, order) => {
      if (!this.blocksById.has(block.blockId)) this.blocksById.set(block.blockId, block)
      return { block, order, maximumEnd: block.renderedEnd }
    }).sort((left, right) => left.block.renderedStart - right.block.renderedStart || left.order - right.order)
    let maximumEnd = -Infinity
    for (const entry of this.blocks) {
      maximumEnd = Math.max(maximumEnd, entry.block.renderedEnd)
      entry.maximumEnd = maximumEnd
    }
  }

  slice(start: number, end = this.length): string {
    const from = this.boundary(start)
    const to = Math.max(from, this.boundary(end))
    return this.text.slice(this.offsets[from], this.offsets[to])
  }

  matches(exact: string): DriveAnnotationTextPositionSelector[] {
    if (!exact) return []
    const matches: DriveAnnotationTextPositionSelector[] = []
    for (let offset = this.text.indexOf(exact); offset !== -1; offset = this.text.indexOf(exact, offset + 1)) {
      const start = this.codePointOffset(offset)
      const end = this.codePointOffset(offset + exact.length)
      // Native indexOf can match half of a surrogate pair; code-point matching cannot.
      if (start !== null && end !== null) matches.push({ start, end })
    }
    return matches
  }

  blockById(id: string): Block | undefined { return this.blocksById.get(id) }

  blockForRange(range: DriveAnnotationTextPositionSelector): Block | undefined {
    let low = 0
    let high = this.blocks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.blocks[middle]!.block.renderedStart <= range.start) low = middle + 1
      else high = middle
    }
    let found: { block: Block; order: number } | undefined
    for (let index = low - 1; index >= 0; index -= 1) {
      const entry = this.blocks[index]!
      if (entry.maximumEnd < range.end) break
      if (entry.block.renderedEnd >= range.end && (!found || entry.order < found.order)) found = entry
    }
    return found?.block
  }

  private boundary(value: number): number {
    const integer = Math.trunc(value) || 0
    return integer < 0 ? Math.max(0, this.length + integer) : Math.min(this.length, integer)
  }

  private codePointOffset(utf16Offset: number): number | null {
    let low = 0
    let high = this.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.offsets[middle]! < utf16Offset) low = middle + 1
      else high = middle
    }
    return this.offsets[low] === utf16Offset ? low : null
  }
}

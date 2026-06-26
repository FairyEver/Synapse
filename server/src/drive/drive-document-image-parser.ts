import { createHash } from "node:crypto"
import remarkParse from "remark-parse"
import { unified } from "unified"
import type {
  DriveMarkdownImageOccurrence,
  DriveMarkdownImageReference,
  DriveMarkdownImageReplaceResult,
} from "./drive-document-image-types"

type MarkdownAstPosition = {
  readonly start?: {
    readonly offset?: number
  }
  readonly end?: {
    readonly offset?: number
  }
}

type MarkdownAstNode = {
  readonly type?: string
  readonly value?: unknown
  readonly url?: unknown
  readonly alt?: unknown
  readonly title?: unknown
  readonly position?: MarkdownAstPosition
  readonly children?: readonly MarkdownAstNode[]
}

type ImageReplacement = {
  readonly start: number
  readonly end: number
  readonly replacement: string
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//iu
const HTML_IMG_TAG_PATTERN = /<img\b[^>]*>/giu
const HTML_SRC_ATTRIBUTE_PATTERN = /\bsrc\s*=\s*(["'])(.*?)\1/iu
const HTML_ALT_ATTRIBUTE_PATTERN = /\balt\s*=\s*(["'])(.*?)\1/iu

export function normalizeDriveMarkdownImageSrc(src: string): string {
  const trimmed = src.trim()
  if (!ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed
  try {
    return new URL(trimmed).toString()
  } catch {
    return trimmed
  }
}

export function driveMarkdownImageKey(src: string): string {
  return `img_${createHash("sha256").update(normalizeDriveMarkdownImageSrc(src), "utf8").digest("hex").slice(0, 16)}`
}

export function extractDriveMarkdownImages(markdown: string): DriveMarkdownImageReference[] {
  const references = new Map<string, DriveMarkdownImageReference>()

  for (const occurrence of collectDriveMarkdownImageOccurrences(markdown)) {
    const existing = references.get(occurrence.src)
    if (existing) {
      references.set(occurrence.src, {
        ...existing,
        occurrenceCount: existing.occurrenceCount + 1,
      })
      continue
    }

    const imageKey = driveMarkdownImageKey(occurrence.src)
    references.set(occurrence.src, {
      id: imageKey,
      imageKey,
      src: occurrence.src,
      occurrenceCount: 1,
      altText: occurrence.altText,
    })
  }

  return Array.from(references.values())
}

export function replaceDriveMarkdownImageSources(
  markdown: string,
  replacements: ReadonlyMap<string, string>,
): DriveMarkdownImageReplaceResult {
  const replacementRanges: ImageReplacement[] = []
  const tree = parseMarkdown(markdown)

  visitMarkdownAst(tree, (node) => {
    if (node.type === "image") {
      const replacement = imageNodeReplacement(markdown, node, replacements)
      if (replacement) replacementRanges.push(replacement)
      return
    }

    if (node.type === "html" && typeof node.value === "string") {
      replacementRanges.push(...htmlImageNodeReplacements(markdown, node, replacements))
    }
  })

  if (replacementRanges.length === 0) {
    return { markdown, replacedOccurrenceCount: 0 }
  }

  const orderedRanges = replacementRanges.slice().sort((left, right) => right.start - left.start)
  let replacedMarkdown = markdown
  for (const range of orderedRanges) {
    replacedMarkdown = `${replacedMarkdown.slice(0, range.start)}${range.replacement}${replacedMarkdown.slice(range.end)}`
  }

  return {
    markdown: replacedMarkdown,
    replacedOccurrenceCount: replacementRanges.length,
  }
}

function collectDriveMarkdownImageOccurrences(markdown: string): DriveMarkdownImageOccurrence[] {
  const occurrences: DriveMarkdownImageOccurrence[] = []
  const tree = parseMarkdown(markdown)

  visitMarkdownAst(tree, (node) => {
    if (node.type === "image" && typeof node.url === "string") {
      occurrences.push({
        src: normalizeDriveMarkdownImageSrc(node.url),
        altText: typeof node.alt === "string" && node.alt.length > 0 ? node.alt : undefined,
      })
      return
    }

    if (node.type === "html" && typeof node.value === "string") {
      occurrences.push(...extractHtmlImageOccurrences(node.value))
    }
  })

  return occurrences
}

function parseMarkdown(markdown: string): MarkdownAstNode {
  return unified().use(remarkParse).parse(markdown) as MarkdownAstNode
}

function visitMarkdownAst(node: MarkdownAstNode, visitor: (node: MarkdownAstNode) => void): void {
  visitor(node)
  for (const child of node.children ?? []) visitMarkdownAst(child, visitor)
}

function extractHtmlImageOccurrences(html: string): DriveMarkdownImageOccurrence[] {
  const occurrences: DriveMarkdownImageOccurrence[] = []
  for (const match of html.matchAll(HTML_IMG_TAG_PATTERN)) {
    const tag = match[0]
    const srcMatch = HTML_SRC_ATTRIBUTE_PATTERN.exec(tag)
    if (!srcMatch?.[2]) continue

    const altMatch = HTML_ALT_ATTRIBUTE_PATTERN.exec(tag)
    occurrences.push({
      src: normalizeDriveMarkdownImageSrc(srcMatch[2]),
      altText: altMatch?.[2] ? altMatch[2] : undefined,
    })
  }
  return occurrences
}

function imageNodeReplacement(
  markdown: string,
  node: MarkdownAstNode,
  replacements: ReadonlyMap<string, string>,
): ImageReplacement | null {
  if (typeof node.url !== "string") return null

  const normalizedSrc = normalizeDriveMarkdownImageSrc(node.url)
  const replacement = replacements.get(normalizedSrc)
  if (!replacement) return null

  const nodeRange = nodePositionRange(node)
  if (!nodeRange) return null

  const nodeMarkdown = markdown.slice(nodeRange.start, nodeRange.end)
  const urlRange = markdownImageUrlRange(nodeMarkdown, node.url)
  if (!urlRange) return null

  return {
    start: nodeRange.start + urlRange.start,
    end: nodeRange.start + urlRange.end,
    replacement,
  }
}

function htmlImageNodeReplacements(
  markdown: string,
  node: MarkdownAstNode,
  replacements: ReadonlyMap<string, string>,
): ImageReplacement[] {
  if (typeof node.value !== "string") return []

  const nodeRange = nodePositionRange(node)
  if (!nodeRange) return []

  const ranges: ImageReplacement[] = []
  for (const match of node.value.matchAll(HTML_IMG_TAG_PATTERN)) {
    if (typeof match.index !== "number") continue

    const tag = match[0]
    const srcMatch = HTML_SRC_ATTRIBUTE_PATTERN.exec(tag)
    if (!srcMatch?.[2]) continue

    const replacement = replacements.get(normalizeDriveMarkdownImageSrc(srcMatch[2]))
    if (!replacement) continue

    const srcValueStart = tag.indexOf(srcMatch[2], srcMatch.index)
    if (srcValueStart < 0) continue

    ranges.push({
      start: nodeRange.start + match.index + srcValueStart,
      end: nodeRange.start + match.index + srcValueStart + srcMatch[2].length,
      replacement,
    })
  }

  return ranges
}

function nodePositionRange(node: MarkdownAstNode): { readonly start: number; readonly end: number } | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== "number" || typeof end !== "number" || start > end) return null
  return { start, end }
}

function markdownImageUrlRange(
  markdownImage: string,
  parsedUrl: string,
): { readonly start: number; readonly end: number } | null {
  const closingParenIndex = markdownImage.lastIndexOf(")")
  if (closingParenIndex < 0) return null

  const destinationStart = markdownImage.lastIndexOf("](", closingParenIndex)
  if (destinationStart < 0) return null

  const rawDestinationStart = destinationStart + 2
  const rawDestination = markdownImage.slice(rawDestinationStart, closingParenIndex)
  const urlStart = rawDestination.indexOf(parsedUrl)
  if (urlStart >= 0) return { start: rawDestinationStart + urlStart, end: rawDestinationStart + urlStart + parsedUrl.length }

  const leadingWhitespaceLength = rawDestination.length - rawDestination.trimStart().length
  const destinationWithoutLeadingWhitespace = rawDestination.slice(leadingWhitespaceLength)
  const destinationEndOffset = destinationWithoutLeadingWhitespace.search(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/u)
  const urlEndInDestination =
    destinationEndOffset >= 0 ? leadingWhitespaceLength + destinationEndOffset : rawDestination.trimEnd().length

  if (urlEndInDestination <= leadingWhitespaceLength) return null
  return {
    start: rawDestinationStart + leadingWhitespaceLength,
    end: rawDestinationStart + urlEndInDestination,
  }
}

import remarkParse from "remark-parse"
import { unified } from "unified"

export const DRIVE_MARKDOWN_RELATIVE_IMAGE_LIMIT = 256

export type DriveMarkdownRelativeImageReference = {
  readonly src: string
  readonly segments: readonly string[]
  readonly suffix: string
}

export type DriveMarkdownRawImage = {
  readonly src: string
  readonly alt?: string
  readonly title?: string
  readonly width?: string
  readonly height?: string
  readonly loading?: string
}

type MarkdownAstNode = {
  readonly type?: string
  readonly url?: unknown
  readonly identifier?: unknown
  readonly value?: unknown
  readonly children?: readonly MarkdownAstNode[]
}

const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/iu
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const STANDALONE_IMG_PATTERN = /^\s*<img\b((?:[^"'<>]|"[^"]*"|'[^']*')*)\/?>\s*$/iu
const QUOTED_ATTRIBUTE_PATTERN = /\b([a-z][a-z\d:-]*)\s*=\s*(["'])(.*?)\2/giu
const SAFE_RASTER_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|avif|ico)$/iu

export function extractDriveMarkdownRelativeImages(
  markdown: string,
  limit = DRIVE_MARKDOWN_RELATIVE_IMAGE_LIMIT,
): DriveMarkdownRelativeImageReference[] {
  const tree = unified().use(remarkParse).parse(markdown) as MarkdownAstNode
  const definitions = collectImageDefinitions(tree)
  const references = new Map<string, DriveMarkdownRelativeImageReference>()

  visitMarkdownAst(tree, (node) => {
    if (references.size >= limit) return
    const src = imageNodeSource(node, definitions)
    if (!src || references.has(src)) return
    const parsed = parseDriveMarkdownRelativeImageSrc(src)
    if (parsed) references.set(src, parsed)
  })

  return [...references.values()]
}

export function parseDriveMarkdownRelativeImageSrc(src: string): DriveMarkdownRelativeImageReference | null {
  const trimmed = src.trim()
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("//")) return null
  if (URI_SCHEME_PATTERN.test(trimmed) || trimmed.includes("\\") || CONTROL_CHARACTER_PATTERN.test(trimmed)) return null

  const suffixStart = firstSuffixIndex(trimmed)
  const path = suffixStart < 0 ? trimmed : trimmed.slice(0, suffixStart)
  const suffix = suffixStart < 0 ? "" : trimmed.slice(suffixStart)
  if (!path || ENCODED_PATH_SEPARATOR_PATTERN.test(path)) return null

  const rawSegments = path.split("/")
  if (rawSegments.some((segment) => segment.length === 0)) return null

  const segments: string[] = []
  for (const rawSegment of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawSegment).normalize("NFC")
    } catch {
      return null
    }
    if (!decoded || decoded.includes("/") || decoded.includes("\\") || CONTROL_CHARACTER_PATTERN.test(decoded)) return null
    segments.push(decoded)
  }

  return { src: trimmed, segments, suffix }
}

export function parseStandaloneDriveMarkdownRawImage(value: string): DriveMarkdownRawImage | null {
  const tag = STANDALONE_IMG_PATTERN.exec(value)
  if (!tag) return null

  const attributes = new Map<string, string>()
  for (const match of tag[1].matchAll(QUOTED_ATTRIBUTE_PATTERN)) {
    attributes.set(match[1].toLowerCase(), match[3])
  }
  const src = attributes.get("src")?.trim()
  if (!src) return null

  return {
    src,
    ...optionalRawImageAttribute(attributes, "alt"),
    ...optionalRawImageAttribute(attributes, "title"),
    ...optionalRawImageAttribute(attributes, "width"),
    ...optionalRawImageAttribute(attributes, "height"),
    ...optionalRawImageAttribute(attributes, "loading"),
  }
}

export function isSafeDriveMarkdownRasterName(name: string): boolean {
  return SAFE_RASTER_EXTENSION_PATTERN.test(name.normalize("NFC"))
}

export function isPlainDriveMarkdownName(name: string): boolean {
  return /\.(?:md|markdown)$/iu.test(name)
}

function collectImageDefinitions(tree: MarkdownAstNode): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>()
  visitMarkdownAst(tree, (node) => {
    if (node.type !== "definition" || typeof node.identifier !== "string" || typeof node.url !== "string") return
    definitions.set(normalizeReferenceIdentifier(node.identifier), node.url)
  })
  return definitions
}

function imageNodeSource(node: MarkdownAstNode, definitions: ReadonlyMap<string, string>): string | null {
  if (node.type === "image" && typeof node.url === "string") return node.url.trim()
  if (node.type === "imageReference" && typeof node.identifier === "string") {
    return definitions.get(normalizeReferenceIdentifier(node.identifier))?.trim() ?? null
  }
  if (node.type === "html" && typeof node.value === "string") {
    return parseStandaloneDriveMarkdownRawImage(node.value)?.src ?? null
  }
  return null
}

function normalizeReferenceIdentifier(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase()
}

function firstSuffixIndex(value: string): number {
  const queryIndex = value.indexOf("?")
  const fragmentIndex = value.indexOf("#")
  if (queryIndex < 0) return fragmentIndex
  if (fragmentIndex < 0) return queryIndex
  return Math.min(queryIndex, fragmentIndex)
}

function optionalRawImageAttribute<K extends "alt" | "title" | "width" | "height" | "loading">(
  attributes: ReadonlyMap<string, string>,
  key: K,
): Partial<Record<K, string>> {
  const value = attributes.get(key)
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, string>>
}

function visitMarkdownAst(node: MarkdownAstNode, visitor: (node: MarkdownAstNode) => void): void {
  visitor(node)
  for (const child of node.children ?? []) visitMarkdownAst(child, visitor)
}

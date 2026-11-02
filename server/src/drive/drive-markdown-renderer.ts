import { createHash } from "node:crypto"
import { PLATFORM_OBJECT_PATH_PREFIX, type DriveMarkdownOutlineItemDto, type DriveMarkdownProjectionDto } from "@synapse/shared"
import {
  annotateMarkdownProjectionTree,
  buildDriveMarkdownProjection,
  extractDriveMarkdownRenderedText,
  DRIVE_MARKDOWN_PARSER_VERSION,
  type MarkdownProjectionNode,
} from "./drive-markdown-projection"
import {
  normalizeDriveMarkdownLooseImageNodes,
  parseDriveMarkdownRelativeImageSrc,
  parseStandaloneDriveMarkdownRawImage,
} from "./drive-markdown-relative-images"

type MarkdownAstNode = {
  type?: string
  value?: unknown
  url?: unknown
  alt?: unknown
  title?: unknown
  depth?: unknown
  align?: readonly (string | null)[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
  children?: MarkdownAstNode[]
  position?: {
    start: { offset?: number }
    end: { offset?: number }
  }
}

type HtmlAstNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HtmlAstNode[]
}

type ResolvedRelativeImage = {
  readonly source: string
  readonly resolvedUrl: string | null
  readonly windowsStyle: boolean
}

export type DriveMarkdownRenderResult = {
  readonly html: string
  readonly outline: readonly DriveMarkdownOutlineItemDto[]
  readonly projection: DriveMarkdownProjectionDto
  readonly renderedText: string
}

export type DriveMarkdownRenderOptions = {
  readonly imageLoading?: "browser" | "eager"
  readonly relativeImageUrls?: ReadonlyMap<string, string | null>
  readonly pdfImageUrlsById?: ReadonlyMap<string, string | null>
  readonly pdfImageResourceKeysById?: ReadonlyMap<string, string | null>
  readonly pdfImageResourceKeys?: ReadonlyMap<string, string | null>
  readonly allowStandaloneRawImages?: boolean
  readonly previousProjection?: {
    readonly source: string
    readonly projection: DriveMarkdownProjectionDto
  } | null
  readonly projection?: DriveMarkdownProjectionDto | null
}

type MutableDriveMarkdownOutlineItem = {
  id: string
  text: string
  depth: number
  children: MutableDriveMarkdownOutlineItem[]
}

const safeHtmlBreakPattern = /^<br\s*\/?>$/iu
const markdownEscapedPunctuationPattern = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu

export async function renderDriveMarkdownFragment(
  markdown: string,
  options: DriveMarkdownRenderOptions = {},
): Promise<DriveMarkdownRenderResult> {
  const prepared = await prepareDriveMarkdownDocument(markdown, options)
  return renderPreparedDriveMarkdownDocument(prepared, options)
}

/** Immutable, permission-independent parse output; resource URLs are resolved per request. */
export type PreparedDriveMarkdownDocument = {
  readonly sourceText: string
  readonly tree: MarkdownAstNode & MarkdownProjectionNode
  readonly projection: DriveMarkdownProjectionDto
  readonly outline: readonly DriveMarkdownOutlineItemDto[]
  readonly renderedText: string
}

export async function prepareDriveMarkdownDocument(
  markdown: string,
  options: DriveMarkdownRenderOptions = {},
): Promise<PreparedDriveMarkdownDocument> {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }] = await Promise.all([
    import("unified"), import("remark-parse"), import("remark-gfm"),
  ])
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownAstNode & MarkdownProjectionNode
  normalizeTableColumnCounts(tree)
  normalizeDriveMarkdownLooseImageNodes(tree)
  if (options.allowStandaloneRawImages === true) visitRawImageAst(tree)
  normalizeSafeTableHtmlBreaks(tree)
  normalizeEscapedRawHtmlNodes(tree)
  normalizeEscapedAutolinkNodes(tree)
  const renderedText = extractDriveMarkdownRenderedText(tree)
  const cachedProjection = options.projection?.parserVersion === DRIVE_MARKDOWN_PARSER_VERSION
    && options.projection.sourceSha256 === createHash("sha256").update(markdown).digest("hex")
    && options.projection.imageAnchorsVersion === 1 ? options.projection : null
  const projection = cachedProjection ?? buildDriveMarkdownProjection(markdown, tree, {
    previous: options.previousProjection ?? (options.projection ? { source: markdown, projection: options.projection } : null),
  })
  annotateMarkdownProjectionTree(tree, projection, markdown)
  const outlineState = { counts: new Map<string, number>(), items: [] as MutableDriveMarkdownOutlineItem[], sequence: 0 }
  createHeadingOutlinePlugin(outlineState)(tree)
  return { sourceText: markdown, tree, projection, outline: outlineState.items, renderedText }
}

export async function renderPreparedDriveMarkdownDocument(
  prepared: PreparedDriveMarkdownDocument,
  options: DriveMarkdownRenderOptions = {},
): Promise<DriveMarkdownRenderResult> {
  const pdfImageResourceKeysById = {
    current: options.pdfImageResourceKeys
      ? new Map((prepared.projection.images ?? []).map((image) => [image.imageId, options.pdfImageResourceKeys?.get(image.resourceKey) ?? null]))
      : options.pdfImageResourceKeysById,
  }
  const [{ unified }, { default: remarkRehype }, { default: rehypeSanitize, defaultSchema }, { default: rehypeStringify }] = await Promise.all([
    import("unified"), import("remark-rehype"), import("rehype-sanitize"), import("rehype-stringify"),
  ])
  const processor = unified()
    .use(escapeRawHtmlPlugin)
    .use(remarkRehype)
    .use(() => resolveRelativeResourceUrlsPlugin(options.relativeImageUrls ?? new Map()))
    .use(() => resolvePdfImageUrlsPlugin(options.pdfImageUrlsById))
    .use(() => resolvePdfImageResourceKeysPlugin(() => pdfImageResourceKeysById.current))
    .use(rehypeSanitize, {
      ...defaultSchema,
      clobberPrefix: "",
      attributes: {
        ...defaultSchema.attributes,
        "*": [
          ...(defaultSchema.attributes?.["*"] ?? []),
          "data-drive-markdown-block-id",
          "data-drive-markdown-segment-id",
          "data-drive-markdown-image-id",
        ],
        a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
        img: [...(defaultSchema.attributes?.img ?? []), "alt", "title", "width", "height", "loading", "data-drive-markdown-relative-src", "data-drive-pdf-resource-key"],
        span: [...(defaultSchema.attributes?.span ?? []), "data-drive-pdf-image-missing"],
      },
      protocols: {
        ...defaultSchema.protocols,
        src: [...(defaultSchema.protocols?.src ?? []), "data", "blob"],
      },
    })
    .use(() => applyImageLoadingPlugin(options.imageLoading))
    .use(wrapTablesPlugin)
    .use(openCompleteWebUrlsExternallyPlugin)
    .use(rehypeStringify)
  const transformed = await processor.run(structuredClone(prepared.tree) as never)
  return {
    html: String(processor.stringify(transformed)),
    outline: prepared.outline,
    projection: prepared.projection,
    renderedText: prepared.renderedText,
  }
}

function applyImageLoadingPlugin(policy: DriveMarkdownRenderOptions["imageLoading"]) {
  return (tree: HtmlAstNode): void => {
    let images = 0
    const visit = (node: HtmlAstNode): void => {
      if (node.tagName === "img" && policy) {
        node.properties = { ...node.properties, loading: policy === "eager" || images === 0 ? "eager" : "lazy", decoding: "async" }
        images += 1
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}

function normalizeTableColumnCounts(node: MarkdownAstNode): void {
  if (node.type === "table" && node.align) {
    const align = node.align
    const columnCount = (node.children ?? []).reduce((width, row) => Math.max(width, row.children?.length ?? 0), align.length)
    // remark-rehype pads rows to this width, preserving overflow content and the authored alignment.
    node.align = Array.from({ length: columnCount }, (_, index) => align[index] ?? null)
  }
  for (const child of node.children ?? []) normalizeTableColumnCounts(child)
}

function normalizeSafeTableHtmlBreaks(node: MarkdownAstNode, insideTableCell = false): void {
  if (insideTableCell && node.type === "html" && typeof node.value === "string" && safeHtmlBreakPattern.test(node.value.trim())) {
    node.type = "break"
    delete node.value
    return
  }
  const childInsideTableCell = insideTableCell || node.type === "tableCell"
  for (const child of node.children ?? []) normalizeSafeTableHtmlBreaks(child, childInsideTableCell)
}


function visitRawImageAst(node: MarkdownAstNode): void {
  if (node.type === "html" && typeof node.value === "string") {
    const image = parseStandaloneDriveMarkdownRawImage(node.value)
    if (image) {
      node.type = "image"
      node.url = image.src
      node.alt = image.alt ?? ""
      node.title = image.title ?? null
      node.data = {
        hName: "img",
        hProperties: {
          ...(image.width === undefined ? {} : { width: image.width }),
          ...(image.height === undefined ? {} : { height: image.height }),
          ...(image.loading === undefined ? {} : { loading: image.loading }),
        },
      }
      delete node.value
      return
    }
  }
  for (const child of node.children ?? []) visitRawImageAst(child)
}

function createHeadingOutlinePlugin(state: {
  readonly counts: Map<string, number>
  readonly items: MutableDriveMarkdownOutlineItem[]
  sequence: number
}) {
  return (tree: MarkdownAstNode) => {
    visitHeadingAst(tree, state)
  }
}

function visitHeadingAst(
  node: MarkdownAstNode,
  state: {
    readonly counts: Map<string, number>
    readonly items: MutableDriveMarkdownOutlineItem[]
    sequence: number
  },
): void {
  if (node.type === "heading" && isMarkdownHeadingDepth(node.depth)) {
    state.sequence += 1
    const text = extractMarkdownNodeText(node).trim()
    const id = uniqueHeadingId(text, state.sequence, state.counts)
    node.data = {
      ...(node.data ?? {}),
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        id,
      },
    }
    if (text) {
      insertOutlineItem(state.items, {
        id,
        text,
        depth: node.depth,
        children: [],
      })
    }
  }

  for (const child of node.children ?? []) visitHeadingAst(child, state)
}

function isMarkdownHeadingDepth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
}

function extractMarkdownNodeText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") return node.value
  return (node.children ?? []).map(extractMarkdownNodeText).join("")
}

function uniqueHeadingId(text: string, sequence: number, counts: Map<string, number>): string {
  const base = slugHeadingText(text) || `heading-${sequence}`
  const count = (counts.get(base) ?? 0) + 1
  counts.set(base, count)
  return count === 1 ? base : `${base}-${count}`
}

function slugHeadingText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
}

function insertOutlineItem(
  roots: MutableDriveMarkdownOutlineItem[],
  item: MutableDriveMarkdownOutlineItem,
): void {
  let siblings = roots
  while (true) {
    const parent = siblings.at(-1)
    if (!parent || parent.depth >= item.depth) {
      siblings.push(item)
      return
    }
    siblings = parent.children
  }
}

function escapeRawHtmlPlugin() {
  return (tree: MarkdownAstNode) => {
    visitMarkdownAst(tree)
  }
}

// Autolinks keep Markdown escape sequences literally, so a document exported by a tool that escapes
// `_` (common in share links such as `shr_xxx_yyy`) renders the backslashes and links to a broken URL.
function normalizeEscapedAutolinkNodes(node: MarkdownAstNode): void {
  const url = node.url
  if (node.type === "link" && typeof url === "string" && url.includes("\\")) {
    const children = node.children ?? []
    const label = children.length === 1 && children[0]?.type === "text" ? children[0] : null
    if (label && typeof label.value === "string" && label.value === url) {
      const unescaped = url.replace(markdownEscapedPunctuationPattern, "$1")
      if (unescaped !== url) {
        node.url = unescaped
        label.value = unescaped
      }
    }
  }
  for (const child of node.children ?? []) normalizeEscapedAutolinkNodes(child)
}

function normalizeEscapedRawHtmlNodes(node: MarkdownAstNode): void {
  if (node.type === "html" && typeof node.value === "string") {
    node.value = stripInlineEventAttributes(node.value)
    return
  }
  for (const child of node.children ?? []) normalizeEscapedRawHtmlNodes(child)
}

function visitMarkdownAst(node: MarkdownAstNode): void {
  if (node.type === "html" && typeof node.value === "string") {
    node.type = "text"
    return
  }
  for (const child of node.children ?? []) visitMarkdownAst(child)
}

function resolveRelativeResourceUrlsPlugin(relativeImageUrls: ReadonlyMap<string, string | null>) {
  const indexedImageUrls = new Map<string, ResolvedRelativeImage>()
  for (const [src, resolvedUrl] of relativeImageUrls) {
    indexedImageUrls.set(relativeImageLookupKey(src), {
      source: src.trim(),
      resolvedUrl,
      windowsStyle: src.includes("\\") && parseDriveMarkdownRelativeImageSrc(src) !== null,
    })
  }
  return (tree: HtmlAstNode) => {
    visitHtmlAst(tree, indexedImageUrls)
  }
}

function resolvePdfImageUrlsPlugin(pdfImageUrlsById: ReadonlyMap<string, string | null> | undefined) {
  return (tree: HtmlAstNode) => {
    if (!pdfImageUrlsById) return
    visitPdfImageAst(tree, pdfImageUrlsById)
  }
}

function resolvePdfImageResourceKeysPlugin(
  getResourceKeysById: () => ReadonlyMap<string, string | null> | undefined,
) {
  return (tree: HtmlAstNode) => {
    const resourceKeysById = getResourceKeysById()
    if (!resourceKeysById) return
    visitPdfImageAst(tree, resourceKeysById, "data-drive-pdf-resource-key")
  }
}

function visitPdfImageAst(
  node: HtmlAstNode,
  imageValuesById: ReadonlyMap<string, string | null>,
  property: "src" | "data-drive-pdf-resource-key" = "src",
): void {
  const imageId = node.properties?.["data-drive-markdown-image-id"]
  if (node.tagName === "img" && typeof imageId === "string" && imageValuesById.has(imageId)) {
    const resolvedValue = imageValuesById.get(imageId) ?? null
    if (resolvedValue) {
      node.properties = { ...node.properties, [property]: resolvedValue }
    } else {
      const alt = typeof node.properties?.alt === "string" ? node.properties.alt.trim() : ""
      node.tagName = "span"
      node.properties = { "data-drive-pdf-image-missing": "true" }
      node.children = [{ type: "text", value: alt ? `图片无法加载：${alt}` : "图片无法加载" }]
    }
  }
  for (const child of node.children ?? []) visitPdfImageAst(child, imageValuesById, property)
}

function wrapTablesPlugin() {
  return (tree: HtmlAstNode) => {
    wrapTablesInHtmlAst(tree)
  }
}

function openCompleteWebUrlsExternallyPlugin() {
  return (tree: HtmlAstNode) => {
    visitCompleteWebUrlLinks(tree)
  }
}

function visitCompleteWebUrlLinks(node: HtmlAstNode): void {
  const properties = node.properties
  const href = properties?.href
  if (node.tagName === "a" && properties && typeof href === "string" && /^https?:\/\//iu.test(href.trim())) {
    properties.target = "_blank"
    properties.rel = ["noopener", "noreferrer"]
  }
  for (const child of node.children ?? []) visitCompleteWebUrlLinks(child)
}

function wrapTablesInHtmlAst(node: HtmlAstNode): void {
  const children = node.children
  if (!children) return

  node.children = children.map((child) => {
    if (child.type === "element" && child.tagName === "table") {
      return {
        type: "element",
        tagName: "div",
        properties: {
          "data-drive-markdown-table-scroll": "true",
        },
        children: [child],
      }
    }

    wrapTablesInHtmlAst(child)
    return child
  })
}

function visitHtmlAst(node: HtmlAstNode, relativeImageUrls: ReadonlyMap<string, ResolvedRelativeImage>): void {
  const properties = node.properties
  if (properties) {
    removeRelativeUrlProperty(properties, "href")
    resolveRelativeImageProperty(properties, relativeImageUrls)
    removeRelativeUrlProperty(properties, "poster")
    removeRelativeUrlProperty(properties, "cite")
    if (typeof properties.srcSet === "string" || Array.isArray(properties.srcSet)) {
      delete properties.srcSet
    }
  }
  for (const child of node.children ?? []) visitHtmlAst(child, relativeImageUrls)
}

function resolveRelativeImageProperty(
  properties: Record<string, unknown>,
  relativeImageUrls: ReadonlyMap<string, ResolvedRelativeImage>,
): void {
  const value = properties.src
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (trimmed.startsWith("/files/") || trimmed.startsWith(`${PLATFORM_OBJECT_PATH_PREFIX}/`)) return
  if (!isRelativeMarkdownUrl(trimmed)) return
  const resolved = relativeImageUrls.get(relativeImageLookupKey(trimmed, true))
  properties["data-drive-markdown-relative-src"] = resolved?.windowsStyle ? resolved.source : trimmed
  if (resolved?.resolvedUrl) properties.src = resolved.resolvedUrl
  else delete properties.src
}

function relativeImageLookupKey(src: string, allowRemarkEncodedWindowsPath = false): string {
  const lookupSource = allowRemarkEncodedWindowsPath
    ? decodeRemarkEncodedWindowsImagePath(src) ?? src
    : src
  const parsed = parseDriveMarkdownRelativeImageSrc(lookupSource)
  if (!parsed) return src.trim()
  return JSON.stringify([lookupSource.includes("\\") ? "windows" : "portable", parsed.segments, parsed.suffix])
}

function decodeRemarkEncodedWindowsImagePath(src: string): string | null {
  const trimmed = src.trim()
  const suffixStart = firstResourceSuffixIndex(trimmed)
  const path = suffixStart < 0 ? trimmed : trimmed.slice(0, suffixStart)
  const suffix = suffixStart < 0 ? "" : trimmed.slice(suffixStart)
  if (path.includes("/") || path.includes("\\") || !/%5c/iu.test(path)) return null
  const decoded = `${path.replace(/%5c/giu, "\\")}${suffix}`
  return parseDriveMarkdownRelativeImageSrc(decoded) ? decoded : null
}

function firstResourceSuffixIndex(value: string): number {
  const queryIndex = value.indexOf("?")
  const fragmentIndex = value.indexOf("#")
  if (queryIndex < 0) return fragmentIndex
  if (fragmentIndex < 0) return queryIndex
  return Math.min(queryIndex, fragmentIndex)
}

function removeRelativeUrlProperty(properties: Record<string, unknown>, key: string): void {
  const value = properties[key]
  if (typeof value === "string" && isRelativeMarkdownUrl(value)) {
    delete properties[key]
  }
}

function isRelativeMarkdownUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith("#")) return false
  if (trimmed.startsWith("//")) return false
  return !/^[a-z][a-z\d+.-]*:/iu.test(trimmed)
}

function stripInlineEventAttributes(value: string): string {
  return value.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
}

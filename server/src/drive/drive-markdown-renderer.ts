import type { DriveMarkdownOutlineItemDto, DriveMarkdownProjectionDto } from "@synapse/shared"
import {
  annotateMarkdownProjectionTree,
  buildDriveMarkdownProjection,
  extractDriveMarkdownRenderedText,
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
  readonly relativeImageUrls?: ReadonlyMap<string, string | null>
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

export async function renderDriveMarkdownFragment(
  markdown: string,
  options: DriveMarkdownRenderOptions = {},
): Promise<DriveMarkdownRenderResult> {
  return renderMarkdownBody(markdown, options)
}

async function renderMarkdownBody(markdown: string, options: DriveMarkdownRenderOptions): Promise<DriveMarkdownRenderResult> {
  const outlineState: {
    readonly counts: Map<string, number>
    readonly items: MutableDriveMarkdownOutlineItem[]
    sequence: number
  } = {
    counts: new Map<string, number>(),
    items: [],
    sequence: 0,
  }
  const [
    { unified },
    { default: remarkParse },
    { default: remarkGfm },
    { default: remarkRehype },
    { default: rehypeSanitize, defaultSchema },
    { default: rehypeStringify },
  ] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-gfm"),
    import("remark-rehype"),
    import("rehype-sanitize"),
    import("rehype-stringify"),
  ])

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => createHeadingOutlinePlugin(outlineState))
    .use(() => prepareStandaloneRawImagesPlugin(options.allowStandaloneRawImages === true))
    .use(escapeRawHtmlPlugin)
    .use(remarkRehype)
    .use(() => resolveRelativeResourceUrlsPlugin(options.relativeImageUrls ?? new Map()))
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
        img: [...(defaultSchema.attributes?.img ?? []), "alt", "title", "width", "height", "loading", "data-drive-markdown-relative-src"],
      },
      protocols: {
        ...defaultSchema.protocols,
        src: [...(defaultSchema.protocols?.src ?? []), "data", "blob"],
      },
    })
    .use(wrapTablesPlugin)
    .use(openCompleteWebUrlsExternallyPlugin)
    .use(rehypeStringify)
  const tree = processor.parse(markdown) as MarkdownAstNode & MarkdownProjectionNode
  normalizeDriveMarkdownLooseImageNodes(tree)
  if (options.allowStandaloneRawImages === true) visitRawImageAst(tree)
  const renderedText = extractDriveMarkdownRenderedText(tree)
  const projection = options.projection ?? buildDriveMarkdownProjection(markdown, tree, { previous: options.previousProjection })
  annotateMarkdownProjectionTree(tree, projection, markdown)
  const transformed = await processor.run(tree as never)
  return {
    html: String(processor.stringify(transformed)),
    outline: outlineState.items,
    projection,
    renderedText,
  }
}

function prepareStandaloneRawImagesPlugin(enabled: boolean) {
  return (tree: MarkdownAstNode) => {
    if (enabled) visitRawImageAst(tree)
  }
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
    insertOutlineItem(state.items, {
      id,
      text: text || `heading ${state.sequence}`,
      depth: node.depth,
      children: [],
    })
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

function visitMarkdownAst(node: MarkdownAstNode): void {
  if (node.type === "html" && typeof node.value === "string") {
    node.type = "text"
    node.value = stripInlineEventAttributes(node.value)
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
  if (trimmed.startsWith("/files/")) return
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

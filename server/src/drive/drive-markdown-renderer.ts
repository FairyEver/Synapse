import type { DriveMarkdownOutlineItemDto } from "@synapse/shared"

type MarkdownAstNode = {
  type?: string
  value?: unknown
  depth?: unknown
  data?: {
    hProperties?: Record<string, unknown>
  }
  children?: MarkdownAstNode[]
}

type HtmlAstNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HtmlAstNode[]
}

export type DriveMarkdownRenderResult = {
  readonly html: string
  readonly outline: readonly DriveMarkdownOutlineItemDto[]
}

type MutableDriveMarkdownOutlineItem = {
  id: string
  text: string
  depth: number
  children: MutableDriveMarkdownOutlineItem[]
}

export async function renderDriveMarkdownFragment(markdown: string): Promise<DriveMarkdownRenderResult> {
  return renderMarkdownBody(markdown)
}

async function renderMarkdownBody(markdown: string): Promise<DriveMarkdownRenderResult> {
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

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => createHeadingOutlinePlugin(outlineState))
    .use(escapeRawHtmlPlugin)
    .use(remarkRehype)
    .use(stripRelativeResourceUrlsPlugin)
    .use(rehypeSanitize, { ...defaultSchema, clobberPrefix: "" })
    .use(wrapTablesPlugin)
    .use(rehypeStringify)
    .process(markdown)
  return {
    html: String(file),
    outline: outlineState.items,
  }
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

function stripRelativeResourceUrlsPlugin() {
  return (tree: HtmlAstNode) => {
    visitHtmlAst(tree)
  }
}

function wrapTablesPlugin() {
  return (tree: HtmlAstNode) => {
    wrapTablesInHtmlAst(tree)
  }
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

function visitHtmlAst(node: HtmlAstNode): void {
  const properties = node.properties
  if (properties) {
    removeRelativeUrlProperty(properties, "href")
    removeRelativeUrlProperty(properties, "src")
    removeRelativeUrlProperty(properties, "poster")
    removeRelativeUrlProperty(properties, "cite")
    if (typeof properties.srcSet === "string" || Array.isArray(properties.srcSet)) {
      delete properties.srcSet
    }
  }
  for (const child of node.children ?? []) visitHtmlAst(child)
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

type MarkdownAstNode = {
  type?: string
  value?: unknown
  children?: MarkdownAstNode[]
}

type HtmlAstNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HtmlAstNode[]
}

export async function renderDriveMarkdownFragment(markdown: string): Promise<string> {
  return renderMarkdownBody(markdown)
}

async function renderMarkdownBody(markdown: string): Promise<string> {
  const [
    { unified },
    { default: remarkParse },
    { default: remarkGfm },
    { default: remarkRehype },
    { default: rehypeSanitize },
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
    .use(escapeRawHtmlPlugin)
    .use(remarkRehype)
    .use(stripRelativeResourceUrlsPlugin)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
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

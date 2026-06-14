import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"

const nodeRequire = createRequire(__filename)

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

type MarkdownRenderInput = {
  readonly title: string
  readonly markdown: string
}

let githubMarkdownCss: Promise<string> | null = null

export async function renderDriveMarkdownDocument(input: MarkdownRenderInput): Promise<string> {
  const [body, css] = await Promise.all([
    renderMarkdownBody(input.markdown),
    readGithubMarkdownCss(),
  ])
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    "<style>",
    css,
    getMarkdownDocumentCss(),
    "</style>",
    "</head>",
    "<body>",
    '<article class="markdown-body">',
    body,
    "</article>",
    "</body>",
    "</html>",
  ].join("")
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

function readGithubMarkdownCss(): Promise<string> {
  githubMarkdownCss ??= readFile(nodeRequire.resolve("github-markdown-css"), "utf8")
  return githubMarkdownCss
}

function getMarkdownDocumentCss(): string {
  return `
body {
  box-sizing: border-box;
  margin: 0;
  min-width: 200px;
}
.markdown-body {
  box-sizing: border-box;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}
@media (max-width: 767px) {
  .markdown-body {
    padding: 15px;
  }
}
`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char))
}

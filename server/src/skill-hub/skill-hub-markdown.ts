import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"

type HtmlNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HtmlNode[]
}

/** Skill frontmatter drives metadata, not the rendered instructions. */
export function stripSkillMarkdownFrontmatter(markdown: string): string {
  const content = markdown.replace(/^\uFEFF/u, "")
  const lines = content.split(/\r?\n/u)
  if (lines[0]?.trim() !== "---") return content
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  return end < 0 ? content : lines.slice(end + 1).join("\n")
}

function replaceImagesWithAltText(node: HtmlNode): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === "element" && child.tagName === "img") {
      const alt = child.properties?.alt
      return typeof alt === "string" && alt.trim() ? [{ type: "text", value: alt }] : []
    }
    replaceImagesWithAltText(child)
    return [child]
  })
}

function unwrapLinks(node: HtmlNode): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === "element" && child.tagName === "a") {
      unwrapLinks(child)
      return child.children ?? []
    }
    unwrapLinks(child)
    return [child]
  })
}

function wrapTables(node: HtmlNode): void {
  if (!node.children) return
  node.children = node.children.map((child) => {
    if (child.type === "element" && child.tagName === "table") {
      return {
        type: "element",
        tagName: "div",
        properties: { "data-skill-markdown-table-scroll": "true" },
        children: [child],
      }
    }
    wrapTables(child)
    return child
  })
}

/**
 * Renders untrusted Skill Markdown as static HTML. Raw HTML is dropped, links are
 * flattened to labels, and images never become requests.
 */
export async function renderSkillHubMarkdown(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(() => replaceImagesWithAltText)
    .use(() => unwrapLinks)
    .use(rehypeSanitize, defaultSchema)
    .use(() => wrapTables)
    .use(rehypeStringify)
  return String(await processor.process(stripSkillMarkdownFrontmatter(markdown)))
}

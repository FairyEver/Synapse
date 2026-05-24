import { createRequire } from "node:module"

import TurndownService from "turndown"

const requireFromHere = createRequire(__filename)
const { gfm } = requireFromHere("turndown-plugin-gfm") as { readonly gfm: TurndownService.Plugin }

export interface HtmlSourceMarkdownInput {
  readonly html: string
  readonly sourceUrl: string
  readonly sourceFinalUrl: string
  readonly fetchedAt: string
  readonly contentType: string
}

export function htmlToSourceMarkdown(input: HtmlSourceMarkdownInput): string {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })
  service.use(gfm)
  service.remove(["script", "style", "noscript", "iframe", "nav", "footer"])

  const markdown = service.turndown(input.html).trim()
  return [
    sourceUrlFrontmatter(input),
    markdown,
    "",
  ].join("\n")
}

export function sourceUrlFrontmatter(input: Omit<HtmlSourceMarkdownInput, "html">): string {
  return [
    "---",
    `source_url: "${escapeYamlString(input.sourceUrl)}"`,
    `source_final_url: "${escapeYamlString(input.sourceFinalUrl)}"`,
    'source_format: "url"',
    `fetched_at: "${escapeYamlString(input.fetchedAt)}"`,
    `content_type: "${escapeYamlString(input.contentType)}"`,
    "---",
    "",
  ].join("\n")
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

import MarkdownIt from "markdown-it"
import markdownItContainer from "markdown-it-container"

type MarkdownContainerToken = {
  info: string
  nesting: number
}

function sanitizeContainerClassname(value: string): string {
  return value.replace(/[^A-Za-z0-9:_/-]/g, "")
}

function createContainerConfig(name: string, tag = "div") {
  return {
    render(tokens: MarkdownContainerToken[], index: number) {
      const token = tokens[index]
      const classnames = token.info.trim().match(/\[.+?\]/g)
        ?.map((item) => sanitizeContainerClassname(item.slice(1, -1)))
        .filter(Boolean)
        .join(" ") ?? ""

      if (token.nesting === 1) {
        return `<${tag}${classnames ? ` class="${classnames}"` : ""}>\n`
      }

      return `</${tag}>\n`
    },
    validate(params: string) {
      return new RegExp(`^${name}(\\s+(.*))?$`).test(params.trim())
    },
  }
}

const markdownRenderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
}).use(markdownItContainer, "md", createContainerConfig("md"))

function renderMarkdown(markdown: string): string {
  return markdownRenderer.render(markdown)
}

export { renderMarkdown }

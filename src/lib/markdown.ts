import MarkdownIt from "markdown-it"
import markdownItContainer from "markdown-it-container"
import hljs from "highlight.js"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("lib.markdown")

// 注册常用语言
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import python from "highlight.js/lib/languages/python"
import shell from "highlight.js/lib/languages/shell"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("css", css)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("java", java)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("python", python)
hljs.registerLanguage("py", python)
hljs.registerLanguage("shell", shell)
hljs.registerLanguage("sh", shell)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("yml", yaml)

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

function escapeHTML(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

function highlightCode(code: string, language: string | undefined): string {
  if (language && hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(code, { language, ignoreIllegals: true })
      return result.value
    } catch {
      logger.warn("Failed to highlight code.", { language })
    }
  }
  return escapeHTML(code)
}

const markdownRenderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  highlight: (code, lang) => {
    const highlighted = highlightCode(code, lang || undefined)
    const langClass = lang ? ` language-${lang}` : ""
    return `<pre class="hljs${langClass}"><code class="hljs${langClass}">${highlighted}</code></pre>`
  },
}).use(markdownItContainer, "md", createContainerConfig("md"))

function renderMarkdown(markdown: string): string {
  return markdownRenderer.render(markdown)
}

export { renderMarkdown }

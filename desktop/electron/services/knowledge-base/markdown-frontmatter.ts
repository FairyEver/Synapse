export interface MarkdownFrontmatter {
  readonly frontmatter: string
  readonly body: string
  readonly lineEnding: "\n" | "\r\n"
}

const FRONTMATTER_PATTERN = /^---(\r?\n)([\s\S]*?)(?:\r?\n)---(?:\r?\n|$)/u

export function parseMarkdownFrontmatter(content: string): MarkdownFrontmatter | null {
  const match = FRONTMATTER_PATTERN.exec(content)
  if (!match?.[1]) return null
  return {
    frontmatter: match[2] ?? "",
    body: content.slice(match[0].length),
    lineEnding: match[1] === "\r\n" ? "\r\n" : "\n",
  }
}

export function splitMarkdownFrontmatter(content: string): MarkdownFrontmatter {
  return parseMarkdownFrontmatter(content) ?? {
    frontmatter: "",
    body: content,
    lineEnding: detectLineEnding(content),
  }
}

export function frontmatterField(frontmatter: string, key: string): string | null {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*([^\\r\\n]+)`, "mu").exec(frontmatter)
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null
}

export function upsertMarkdownFrontmatterField(content: string, key: string, value: string): string {
  const parsed = parseMarkdownFrontmatter(content)
  const lineEnding = parsed?.lineEnding ?? detectLineEnding(content)
  const nextLine = `${key}: ${value}`
  if (!parsed) {
    return `---${lineEnding}${nextLine}${lineEnding}---${lineEnding}${content}`
  }

  const lines = parsed.frontmatter.length > 0
    ? parsed.frontmatter.split(/\r?\n/u)
    : []
  const existingIndex = lines.findIndex((line) =>
    new RegExp(`^${escapeRegExp(key)}:\\s*`, "u").test(line))
  if (existingIndex >= 0) {
    lines[existingIndex] = nextLine
  } else {
    lines.unshift(nextLine)
  }
  return `---${lineEnding}${lines.join(lineEnding)}${lineEnding}---${lineEnding}${parsed.body}`
}

function detectLineEnding(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n"
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

import type { ClaudeCodeRuleFrontmatter } from "../../../src/types/editor"
import { decodeYamlScalar, encodeYamlScalar } from "./yaml-scalar"

const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function serializeClaudeCodeFrontmatter(frontmatter: ClaudeCodeRuleFrontmatter): string {
  const paths = frontmatter.paths.trim()
  if (!paths) {
    return ""
  }

  const items = paths.split(",").map((p) => p.trim()).filter(Boolean)
  const yamlLines = items.map((item) => `  - ${encodeYamlScalar(item)}`)

  return `---\npaths:\n${yamlLines.join("\n")}\n---\n\n`
}

function parseClaudeCodeFrontmatter(fileContent: string): ClaudeCodeRuleFrontmatter | null {
  const match = FRONTMATTER_BLOCK_PATTERN.exec(fileContent)

  if (!match) {
    return null
  }

  const body = match[1] ?? ""
  const lines = body.split(/\r?\n/)

  let paths = ""
  let inPaths = false
  const pathItems: string[] = []

  for (const line of lines) {
    const keyValue = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line)

    if (keyValue) {
      const [, key, rawValue] = keyValue
      inPaths = key === "paths"

      if (inPaths && rawValue) {
        paths = decodeYamlScalar(rawValue)
      }
      continue
    }

    if (inPaths) {
      const listItem = /^\s+-\s+(.+)$/.exec(line)
      if (listItem) {
        pathItems.push(decodeYamlScalar(listItem[1]))
      } else {
        inPaths = false
      }
    }
  }

  if (pathItems.length > 0) {
    paths = pathItems.join(", ")
  }

  if (!paths) {
    return null
  }

  return { paths }
}

function stripClaudeCodeFrontmatter(fileContent: string): string {
  return fileContent.replace(FRONTMATTER_BLOCK_PATTERN, "")
}

export { parseClaudeCodeFrontmatter, serializeClaudeCodeFrontmatter, stripClaudeCodeFrontmatter }

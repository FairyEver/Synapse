import { decodeYamlScalar, encodeYamlScalar } from "../shared-yaml-scalar"

type CursorRuleFrontmatter = {
  description: string
  globs: string
  alwaysApply: boolean
}

const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseBoolean(raw: string): boolean {
  return decodeYamlScalar(raw).toLowerCase() === "true"
}

function serializeMdcFrontmatter(frontmatter: CursorRuleFrontmatter): string {
  const description = encodeYamlScalar(frontmatter.description.trim())
  const globs = encodeYamlScalar(frontmatter.globs.trim())
  const alwaysApply = frontmatter.alwaysApply ? "true" : "false"

  return `---\ndescription: ${description}\nglobs: ${globs}\nalwaysApply: ${alwaysApply}\n---\n\n`
}

function parseMdcFrontmatter(fileContent: string): CursorRuleFrontmatter | null {
  const match = FRONTMATTER_BLOCK_PATTERN.exec(fileContent)

  if (!match) {
    return null
  }

  const body = match[1] ?? ""
  const lines = body.split(/\r?\n/)

  let description = ""
  let globs = ""
  let alwaysApply = false

  for (const line of lines) {
    const keyValue = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line)

    if (!keyValue) {
      continue
    }

    const [, key, rawValue] = keyValue

    if (key === "description") {
      description = decodeYamlScalar(rawValue)
    } else if (key === "globs") {
      globs = decodeYamlScalar(rawValue)
    } else if (key === "alwaysApply") {
      alwaysApply = parseBoolean(rawValue)
    }
  }

  return { alwaysApply, description, globs }
}

function stripMdcFrontmatter(fileContent: string): string {
  return fileContent.replace(FRONTMATTER_BLOCK_PATTERN, "")
}

export { parseMdcFrontmatter, serializeMdcFrontmatter, stripMdcFrontmatter }
export type { CursorRuleFrontmatter }

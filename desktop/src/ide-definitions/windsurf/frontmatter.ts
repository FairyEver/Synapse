import { decodeYamlScalar, encodeYamlScalar } from "../shared-yaml-scalar"

type WindsurfRuleTrigger = "always_on" | "model_decision" | "glob" | "manual"

type WindsurfRuleFrontmatter = {
  trigger: WindsurfRuleTrigger
  description: string
  globs: string
}

const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const TRIGGERS = new Set<WindsurfRuleTrigger>([
  "always_on",
  "model_decision",
  "glob",
  "manual",
])

function isWindsurfRuleTrigger(value: string): value is WindsurfRuleTrigger {
  return TRIGGERS.has(value as WindsurfRuleTrigger)
}

function serializeWindsurfRuleFrontmatter(frontmatter: WindsurfRuleFrontmatter): string {
  const lines = [`trigger: ${frontmatter.trigger}`]
  const description = frontmatter.description.trim()
  const globs = frontmatter.globs.trim()

  if (frontmatter.trigger === "model_decision" && description) {
    lines.push(`description: ${encodeYamlScalar(description)}`)
  }

  if (frontmatter.trigger === "glob" && globs) {
    lines.push(`globs: ${encodeYamlScalar(globs)}`)
  }

  return `---\n${lines.join("\n")}\n---\n\n`
}

function parseWindsurfRuleFrontmatter(fileContent: string): WindsurfRuleFrontmatter | null {
  const match = FRONTMATTER_BLOCK_PATTERN.exec(fileContent)

  if (!match) {
    return null
  }

  const body = match[1] ?? ""
  const lines = body.split(/\r?\n/)
  let trigger: WindsurfRuleTrigger = "model_decision"
  let description = ""
  let globs = ""

  for (const line of lines) {
    const keyValue = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line)

    if (!keyValue) {
      continue
    }

    const [, key, rawValue] = keyValue
    const value = decodeYamlScalar(rawValue)

    if (key === "trigger" && isWindsurfRuleTrigger(value)) {
      trigger = value
    } else if (key === "description") {
      description = value
    } else if (key === "globs") {
      globs = value
    }
  }

  return { trigger, description, globs }
}

function stripWindsurfRuleFrontmatter(fileContent: string): string {
  return fileContent.replace(FRONTMATTER_BLOCK_PATTERN, "")
}

export {
  parseWindsurfRuleFrontmatter,
  serializeWindsurfRuleFrontmatter,
  stripWindsurfRuleFrontmatter,
}
export type { WindsurfRuleFrontmatter, WindsurfRuleTrigger }

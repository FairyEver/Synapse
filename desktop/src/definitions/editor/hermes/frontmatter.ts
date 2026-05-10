type HermesSkillFrontmatter = {
  name: string
  description: string
  version: string
  category: string
  tags: string[]
}

function encodeYamlScalar(value: string): string {
  if (value.length === 0) return '""'
  if (/[\n\r:#]/.test(value) || /^[&*!|>'"%@`\-?,[\]{}]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return value
}

function serializeHermesSkillFrontmatter(frontmatter: HermesSkillFrontmatter): string {
  const name = encodeYamlScalar(frontmatter.name.trim())
  const description = encodeYamlScalar(frontmatter.description.trim())
  const version = encodeYamlScalar(frontmatter.version.trim())
  const tagsLine = frontmatter.tags.length > 0
    ? `    tags: [${frontmatter.tags.map((t) => encodeYamlScalar(t.trim())).join(", ")}]`
    : "    tags: []"

  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    "metadata:",
    "  hermes:",
    tagsLine,
    `    category: ${encodeYamlScalar(frontmatter.category.trim())}`,
    "---",
    "",
    "",
  ].join("\n")
}

export { serializeHermesSkillFrontmatter }
export type { HermesSkillFrontmatter }

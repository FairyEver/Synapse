import { validateSkillNameInput } from "../../lib/skill-name-input"

type SkillFrontmatter = {
  name: string
  description: string
}

function slugifySkillName(source: string, fallback: string): string {
  const normalized = normalizeSkillSlugCandidate(source)

  if (isValidSkillSlug(normalized)) {
    return normalized
  }

  const fallbackNormalized = normalizeSkillSlugCandidate(fallback)

  if (isValidSkillSlug(fallbackNormalized)) {
    return fallbackNormalized
  }

  return "synapse-skill"
}

function normalizeSkillSlugCandidate(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function isValidSkillSlug(value: string): boolean {
  return validateSkillNameInput(value) === null
}

function needsDoubleQuote(value: string): boolean {
  if (value.length === 0) {
    return false
  }

  if (/[\n\r]/.test(value)) {
    return true
  }

  if (/[:#]/.test(value)) {
    return true
  }

  return /^[&*!|>'"%@`\-?,\[\]{}]/.test(value)
}

function encodeYamlScalar(value: string): string {
  if (!needsDoubleQuote(value)) {
    return value
  }

  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
}

function serializeSkillFrontmatter(frontmatter: SkillFrontmatter): string {
  const name = encodeYamlScalar(frontmatter.name.trim())
  const description = encodeYamlScalar(frontmatter.description.trim())

  return `---\nname: ${name}\ndescription: ${description}\n---\n\n`
}

export { serializeSkillFrontmatter, slugifySkillName }
export type { SkillFrontmatter }

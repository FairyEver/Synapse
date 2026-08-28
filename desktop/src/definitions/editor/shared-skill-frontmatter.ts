import { validateSkillNameInput } from "../../lib/skill-name-input"
import { parseFrontmatterBlock } from "./shared-yaml-scalar"

type SkillFrontmatter = {
  name: string
  description: string
}

type ParsedSkillFrontmatter = {
  metadata: Record<string, string>
  body: string
}

function parseSkillFrontmatter(text: string): ParsedSkillFrontmatter {
  if (!text.startsWith("---")) return { metadata: {}, body: text.trim() }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return { metadata: {}, body: text.trim() }

  const { metadata } = parseFrontmatterBlock(text.slice(4, endIndex))
  return {
    metadata,
    body: text.slice(endIndex + 4).trim(),
  }
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

export { parseSkillFrontmatter, serializeSkillFrontmatter, slugifySkillName }
export type { ParsedSkillFrontmatter, SkillFrontmatter }

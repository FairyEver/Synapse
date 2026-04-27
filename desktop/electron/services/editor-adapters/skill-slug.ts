import { slugifySkillName } from "../../../src/definitions/editor/shared-skill-frontmatter"

/**
 * Decide the slug used as the Skill directory name.
 *
 * Priority:
 * 1. The user-supplied `name` field (validated in the UI to match
 *    `/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/`). Used verbatim.
 * 2. Legacy fallback: slugify the title, falling back to the contentId UUID
 *    when the title contains no usable ASCII characters.
 */
function resolveSkillSlug(
  skillName: string | undefined,
  skillTitle: string | undefined,
  contentId: string,
): string {
  const trimmedName = skillName?.trim() ?? ""

  if (trimmedName.length > 0) {
    return trimmedName
  }

  return slugifySkillName(skillTitle ?? "", contentId)
}

export { resolveSkillSlug }

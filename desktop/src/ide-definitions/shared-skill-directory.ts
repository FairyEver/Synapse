import path from "node:path"
import type { PrepareSkillDirectoryContext } from "./main-types"
import { SYNAPSE_SKILL_ID_FILE_NAME } from "../../electron/services/editor-adapters/skill-identity"
import { serializeSkillFrontmatter } from "./shared-skill-frontmatter"

const INSTALLED_SKILL_MAIN_FILE_NAME = "SKILL.md"

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

async function writeSynapseSkillDirectory({
  copyAttachment,
  detail,
  stagingDirectoryPath,
  targetPath,
  writeTextFile,
}: PrepareSkillDirectoryContext): Promise<void> {
  const skillMainContent = serializeSkillFrontmatter({
    description: detail.description,
    name: path.basename(targetPath),
  }) + detail.content

  await writeTextFile(
    path.join(stagingDirectoryPath, INSTALLED_SKILL_MAIN_FILE_NAME),
    normalizeMarkdownContent(skillMainContent),
  )

  await writeTextFile(
    path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME),
    JSON.stringify({ id: detail.id }, null, 2),
  )

  for (const attachment of detail.attachments) {
    await copyAttachment(
      attachment,
      path.join(stagingDirectoryPath, attachment.originalName),
    )
  }
}

export { INSTALLED_SKILL_MAIN_FILE_NAME, writeSynapseSkillDirectory }

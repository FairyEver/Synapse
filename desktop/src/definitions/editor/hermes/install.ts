import path from "node:path"
import type { EditorInstallStrategy } from "../../main-types"
import {
  SKILL_ENV_EXAMPLE_PATH,
  normalizeContentAttachmentPath,
} from "../../../lib/content-attachments"
import { normalizePathForCompare } from "../../../lib/path-compare"
import { SYNAPSE_SKILL_ID_FILE_NAME } from "../../../../electron/services/editor-adapters/skill-identity"
import { applyRuleSection } from "../shared-rule-section"
import { serializeHermesSkillFrontmatter } from "./frontmatter"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return applyRuleSection(existing, payload.contentId, ruleBody)
  },
  async prepareSkillDirectory({ payload, detail, stagingDirectoryPath, targetPath, writeTextFile, copyAttachment }) {
    const formValues = payload.installFormValues ?? {}
    const category = typeof formValues.category === "string" ? formValues.category : "general"
    const tagsRaw = typeof formValues.tags === "string" ? formValues.tags : ""
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    const version = typeof formValues.version === "string" ? formValues.version : "1.0.0"

    const skillMainContent = serializeHermesSkillFrontmatter({
      name: path.basename(targetPath),
      description: detail.description,
      version,
      category,
      tags,
    }) + detail.content

    await writeTextFile(
      path.join(stagingDirectoryPath, "SKILL.md"),
      skillMainContent.endsWith("\n") ? skillMainContent : `${skillMainContent}\n`,
    )

    await writeTextFile(
      path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME),
      JSON.stringify({ id: detail.id }, null, 2),
    )

    for (const attachment of detail.attachments) {
      const originalName = normalizeContentAttachmentPath(attachment.originalName)
      if (!originalName) {
        throw new Error("附件文件名不能为空。")
      }
      await copyAttachment(
        { ...attachment, originalName },
        normalizePathForCompare(originalName, { platform: "win32" })
          === normalizePathForCompare(SKILL_ENV_EXAMPLE_PATH, { platform: "win32" })
          ? path.join(stagingDirectoryPath, SKILL_ENV_EXAMPLE_PATH)
          : path.join(stagingDirectoryPath, "references", originalName),
      )
    }
  },
}

import type { SynapseEditorInstallFormValues } from "../../types/editor"
import type { EditorInstallStrategy } from "../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import {
  parseClaudeCodeFrontmatter,
  serializeClaudeCodeFrontmatter,
  type ClaudeCodeRuleFrontmatter,
} from "./frontmatter"

function readFrontmatterValues(
  values: SynapseEditorInstallFormValues | undefined,
): ClaudeCodeRuleFrontmatter | null {
  if (!values) {
    return null
  }

  return {
    paths: typeof values.paths === "string" ? values.paths : "",
  }
}

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, ruleBody }) {
    const frontmatter = readFrontmatterValues(payload.installFormValues)
    const frontmatterPrefix = frontmatter
      ? serializeClaudeCodeFrontmatter(frontmatter)
      : ""
    return frontmatterPrefix + ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
  async readRuleProjectFormValues({ targetPath, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return parseClaudeCodeFrontmatter(existing)
  },
}

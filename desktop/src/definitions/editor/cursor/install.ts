import type { SynapseEditorInstallFormValues } from "../../../types/editor"
import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import {
  parseMdcFrontmatter,
  serializeMdcFrontmatter,
  type CursorRuleFrontmatter,
} from "./frontmatter"

function readFrontmatterValues(
  values: SynapseEditorInstallFormValues | undefined,
): CursorRuleFrontmatter | null {
  if (!values) {
    return null
  }

  return {
    alwaysApply: values.alwaysApply === true,
    description: typeof values.description === "string" ? values.description : "",
    globs: typeof values.globs === "string" ? values.globs : "",
  }
}

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, ruleBody }) {
    const frontmatter = readFrontmatterValues(payload.installFormValues)
    return frontmatter
      ? serializeMdcFrontmatter(frontmatter) + ruleBody
      : ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
  async readRuleProjectFormValues({ targetPath, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return parseMdcFrontmatter(existing)
  },
}

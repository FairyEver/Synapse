import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import { applyRuleSection } from "../shared-rule-section"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return applyRuleSection(existing, payload.contentId, ruleBody)
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}

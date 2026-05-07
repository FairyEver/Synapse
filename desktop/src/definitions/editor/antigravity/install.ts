import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import { applyRuleSection } from "../shared-rule-section"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    if (payload.scope === "global") {
      const existing = await readExistingTextFile(targetPath)
      return applyRuleSection(existing, payload.contentId, ruleBody)
    }

    return ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}

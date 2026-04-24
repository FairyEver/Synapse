import type { EditorInstallStrategy } from "../types"
import { applyRuleSection } from "../../editor-adapters/rule-section"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return applyRuleSection(existing, payload.contentId, ruleBody)
  },
}

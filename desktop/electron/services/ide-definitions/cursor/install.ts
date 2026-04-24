import type { EditorInstallStrategy } from "../types"
import { serializeMdcFrontmatter } from "../../editor-adapters/cursor-mdc"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, ruleBody }) {
    return payload.cursorFrontmatter
      ? serializeMdcFrontmatter(payload.cursorFrontmatter) + ruleBody
      : ruleBody
  },
}

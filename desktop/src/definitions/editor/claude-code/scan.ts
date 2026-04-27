import type { EditorScanStrategy } from "../../main-types"
import { scanClaudeCodeRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanClaudeCodeRules(rulesPath) : []
  },
}

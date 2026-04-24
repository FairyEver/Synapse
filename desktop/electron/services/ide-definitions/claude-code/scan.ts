import type { EditorScanStrategy } from "../types"
import { scanClaudeCodeRules } from "../rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanClaudeCodeRules(rulesPath) : []
  },
}

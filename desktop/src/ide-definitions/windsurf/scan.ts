import { stat } from "node:fs/promises"
import type { EditorScanStrategy } from "../main-types"
import { scanClaudeCodeRules, scanCodexRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    if (!rulesPath) {
      return []
    }

    try {
      const info = await stat(rulesPath)
      return info.isDirectory()
        ? scanClaudeCodeRules(rulesPath)
        : scanCodexRules(rulesPath)
    } catch {
      return []
    }
  },
}

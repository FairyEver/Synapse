import type { EditorScanStrategy } from "../types"
import { scanCodexRules } from "../rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanCodexRules(rulesPath) : []
  },
}

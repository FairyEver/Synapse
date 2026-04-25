import type { EditorScanStrategy } from "../main-types"
import { scanCodexRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanCodexRules(rulesPath) : []
  },
}

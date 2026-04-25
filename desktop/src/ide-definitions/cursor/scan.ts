import type { EditorScanStrategy } from "../main-types"
import { scanCursorRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanCursorRules(rulesPath) : []
  },
}

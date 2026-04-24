import type { EditorScanStrategy } from "../types"
import { scanCursorRules } from "../rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanCursorRules(rulesPath) : []
  },
}

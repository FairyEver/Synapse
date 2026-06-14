import type { ActionRunResult } from "../../action-packages/types"
import { redactSensitiveText, redactSensitiveValue } from "../../src/lib/agent-redaction"

function sanitizePersistableActionRunResult(result: ActionRunResult): ActionRunResult {
  return {
    ...result,
    ...(result.summary === undefined ? {} : { summary: redactSensitiveText(result.summary) }),
    ...(result.logs === undefined ? {} : {
      logs: result.logs.map((log) => ({
        ...log,
        value: redactSensitiveText(log.value),
      })),
    }),
    ...(result.outputs === undefined ? {} : {
      outputs: redactSensitiveValue(result.outputs) as Record<string, unknown>,
    }),
  }
}

export { sanitizePersistableActionRunResult }

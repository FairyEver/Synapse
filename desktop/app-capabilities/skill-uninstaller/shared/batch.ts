import type {
  SkillUninstallBatchResult,
  SkillUninstallRequest,
  SkillUninstallTarget,
} from "./schema"
import { SKILL_UNINSTALL_MAX_TARGETS } from "./schema"

type RunSkillUninstallBatchesInput = {
  targets: readonly SkillUninstallTarget[]
  invoke: (request: SkillUninstallRequest) => Promise<SkillUninstallBatchResult>
  shouldCancel: () => boolean
  onOperationChange: (operationId: string | null) => void
  onProgress: (completed: number) => void
  createOperationId?: () => string
}

export async function runSkillUninstallBatches(
  input: RunSkillUninstallBatchesInput,
): Promise<SkillUninstallBatchResult> {
  const results: SkillUninstallBatchResult["results"] = []
  let cancelled = false

  for (let offset = 0; offset < input.targets.length; offset += SKILL_UNINSTALL_MAX_TARGETS) {
    if (input.shouldCancel()) {
      cancelled = true
      break
    }
    const operationId = input.createOperationId?.() ?? crypto.randomUUID()
    input.onOperationChange(operationId)
    try {
      const batch = await input.invoke({
        operationId,
        targets: input.targets.slice(offset, offset + SKILL_UNINSTALL_MAX_TARGETS),
      })
      results.push(...batch.results)
      input.onProgress(results.length)
      if (batch.cancelled || input.shouldCancel()) {
        cancelled = true
        break
      }
    } finally {
      input.onOperationChange(null)
    }
  }

  return {
    results,
    ...(cancelled ? { cancelled: true } : {}),
  }
}

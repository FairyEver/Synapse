import { describe, expect, it, vi } from "vitest"

import { runSkillUninstallBatches } from "../batch"
import { SKILL_UNINSTALL_MAX_TARGETS, type SkillUninstallTarget } from "../schema"

describe("runSkillUninstallBatches", () => {
  it("splits large selections into bounded sequential requests", async () => {
    const targets: SkillUninstallTarget[] = Array.from(
      { length: SKILL_UNINSTALL_MAX_TARGETS + 1 },
      (_, index) => ({ query: { name: `skill-${index}` }, path: `/tmp/skill-${index}` }),
    )
    const invoke = vi.fn(async (request: { targets: SkillUninstallTarget[] }) => ({
      results: request.targets.map((target) => ({ path: target.path, status: "trashed" as const })),
    }))

    const result = await runSkillUninstallBatches({
      targets,
      invoke,
      shouldCancel: () => false,
      onOperationChange: vi.fn(),
      onProgress: vi.fn(),
      createOperationId: (() => {
        let index = 0
        return () => `operation-${index += 1}`
      })(),
    })

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls.map(([request]) => request.targets.length)).toEqual([
      SKILL_UNINSTALL_MAX_TARGETS,
      1,
    ])
    expect(result.results).toHaveLength(SKILL_UNINSTALL_MAX_TARGETS + 1)
  })
})

import { describe, expect, it } from "vitest"

import { agentActionConfigSchema } from "../schema"

const baseConfig = {
  projectId: "project-1",
  agentType: "claude-code",
  prompt: "Run scheduled work",
  sessionPolicy: "fresh",
  timeoutMins: 30,
} as const

describe("agent action config schema", () => {
  it("accepts unattended Claude SDK modes for background Agent tasks", () => {
    for (const mode of ["auto", "bypassPermissions", "dontAsk"]) {
      expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode }).success).toBe(true)
    }
  })

  it("rejects interactive Claude SDK modes for background Agent tasks", () => {
    for (const mode of ["default", "acceptEdits", "plan"]) {
      expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode }).success).toBe(false)
    }
  })
})

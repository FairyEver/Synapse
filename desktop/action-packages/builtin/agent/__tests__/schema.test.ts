import { describe, expect, it } from "vitest"

import { agentActionConfigSchema } from "../schema"

const baseConfig = {
  projectId: "project-1",
  agentType: "claude-code",
  providerId: "anthropic",
  modelTier: "sonnet",
  prompt: "Run scheduled work",
  sessionPolicy: "fresh",
  timeoutMins: 30,
} as const

describe("agent action config schema", () => {
  it("accepts Claude Code permission modes for scheduled Agent tasks", () => {
    for (const mode of ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]) {
      expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode }).success).toBe(true)
    }
  })

  it("rejects unknown Claude Code permission modes", () => {
    expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode: "free-for-all" }).success).toBe(false)
  })
})

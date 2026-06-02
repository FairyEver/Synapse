import { describe, expect, it } from "vitest"

import { agentActionManifest } from "../manifest"

describe("builtin agent action manifest", () => {
  it("defaults scheduled Agent tasks to a one-hour timeout", () => {
    const timeoutField = agentActionManifest.configFields.find((field) => field.name === "timeoutMins")

    expect(agentActionManifest.defaultConfig.timeoutMins).toBe(60)
    expect(timeoutField?.defaultValue).toBe(60)
  })

  it("only exposes agent type choices accepted by its config schema", () => {
    const agentTypeField = agentActionManifest.configFields.find((field) => field.name === "agentType")
    const choices = agentTypeField?.choices ?? []

    expect(choices.length).toBeGreaterThan(0)

    for (const agentType of choices) {
      const result = agentActionManifest.configSchema.safeParse({
        ...agentActionManifest.defaultConfig,
        projectId: "project-1",
        agentType,
        providerId: "anthropic",
        prompt: "Run the scheduled task",
      })

      expect(result.success).toBe(true)
    }
  })
})

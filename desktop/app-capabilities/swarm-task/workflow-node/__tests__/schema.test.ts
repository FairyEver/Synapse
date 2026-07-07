import { describe, expect, it } from "vitest"

import { swarmTaskNodeConfigSchema } from "../schema"

describe("swarmTaskNodeConfigSchema", () => {
  it("accepts minimal config", () => {
    expect(swarmTaskNodeConfigSchema.parse({
      taskId: "task-1",
    })).toEqual({
      taskId: "task-1",
      waitForCompletion: false,
    })
  })

  it("accepts overrides", () => {
    expect(swarmTaskNodeConfigSchema.parse({
      taskId: "task-1",
      promptOverride: "Run.",
      runModeOverride: "continuous",
      maxRoundsOverride: 5,
      concurrencyOverride: 2,
      waitForCompletion: true,
    })).toEqual({
      taskId: "task-1",
      promptOverride: "Run.",
      runModeOverride: "continuous",
      maxRoundsOverride: 5,
      concurrencyOverride: 2,
      waitForCompletion: true,
    })
  })
})

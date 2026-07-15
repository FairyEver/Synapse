import { describe, expect, it } from "vitest"

import { swarmTaskNodeManifest } from "../manifest"
import { swarmTaskNodeConfigSchema } from "../schema"

describe("swarmTaskNodeConfigSchema", () => {
  it("accepts minimal config", () => {
    expect(swarmTaskNodeConfigSchema.parse({
      taskId: "task-1",
    })).toEqual({
      taskId: "task-1",
      waitForCompletion: false,
      variables: [],
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
      variables: [],
    })
  })

  it("describes waitForCompletion as a boolean field", () => {
    expect(swarmTaskNodeManifest.configFields).toContainEqual({
      name: "waitForCompletion",
      kind: "boolean",
      label: "等待完成",
      optional: true,
    })
  })
})

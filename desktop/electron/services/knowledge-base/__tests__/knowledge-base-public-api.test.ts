import { describe, expect, it } from "vitest"

describe("knowledge-base service public API", () => {
  it("does not expose the DragonScale script compatibility runner", async () => {
    const module = await import("../index") as Record<string, unknown>

    expect(module.DragonScaleScriptRunner).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"

import { scriptNodeManifest } from "../manifest"

describe("script node schema", () => {
  it("accepts the manifest default config", () => {
    expect(scriptNodeManifest.configSchema.safeParse(scriptNodeManifest.defaultConfig).success).toBe(true)
  })
})

import { describe, expect, it } from "vitest"

import { openFileNodeConfigSchema } from "../schema"

describe("openFileNodeConfigSchema", () => {
  it("accepts one path template and variable bindings", () => {
    expect(openFileNodeConfigSchema.parse({
      filePath: "{{source}}",
      variables: [{ name: "source", source: { type: "param", param: "source" } }],
    })).toBeDefined()
  })

  it("rejects an empty file path", () => {
    expect(openFileNodeConfigSchema.safeParse({ filePath: "", variables: [] }).success).toBe(false)
  })
})

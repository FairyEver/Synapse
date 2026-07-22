import path from "node:path"
import { describe, expect, it } from "vitest"
import { textExtractNodeConfigSchema } from "../schema"

describe("textExtractNodeConfigSchema", () => {
  it("accepts a fixed local file path", () => {
    expect(textExtractNodeConfigSchema.safeParse({
      filePath: path.resolve("tmp", "report.pdf"),
      variables: [],
    }).success).toBe(true)
  })

  it("accepts parameter and upstream-output bindings", () => {
    expect(textExtractNodeConfigSchema.safeParse({
      filePath: "{{source}}",
      variables: [
        { name: "parameter", source: { type: "param", param: "document" } },
        { name: "upstream", source: { type: "node_output", node: "select-file" } },
      ],
    }).success).toBe(true)
  })

  it("rejects an empty file path", () => {
    expect(textExtractNodeConfigSchema.safeParse({
      filePath: "   ",
      variables: [],
    }).success).toBe(false)
  })
})

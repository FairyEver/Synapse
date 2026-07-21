import path from "node:path"
import { describe, expect, it } from "vitest"
import { documentTextExtractNodeConfigSchema } from "../schema"

describe("documentTextExtractNodeConfigSchema", () => {
  it("accepts a fixed local file path", () => {
    expect(documentTextExtractNodeConfigSchema.safeParse({
      filePath: path.resolve("tmp", "report.pdf"),
      variables: [],
    }).success).toBe(true)
  })

  it("accepts parameter and upstream-output bindings", () => {
    expect(documentTextExtractNodeConfigSchema.safeParse({
      filePath: "{{source}}",
      variables: [
        { name: "parameter", source: { type: "param", param: "document" } },
        { name: "upstream", source: { type: "node_output", node: "select-file" } },
      ],
    }).success).toBe(true)
  })

  it("rejects an empty file path", () => {
    expect(documentTextExtractNodeConfigSchema.safeParse({
      filePath: "   ",
      variables: [],
    }).success).toBe(false)
  })
})

import { describe, expect, it } from "vitest"

import { executeDocxToMarkdown } from "../executor"

describe("docx-to-markdown executor", () => {
  it("rejects non-docx input", async () => {
    await expect(executeDocxToMarkdown({
      inputPath: "/tmp/source.pdf",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })
})


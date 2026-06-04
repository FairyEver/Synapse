import { describe, expect, it } from "vitest"

import { executePptxToMarkdown } from "../executor"

describe("pptx-to-markdown executor", () => {
  it("rejects non-pptx input", async () => {
    await expect(executePptxToMarkdown({
      inputPath: "/tmp/source.docx",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })
})


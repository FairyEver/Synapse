import { describe, expect, it } from "vitest"

import { executePdfToMarkdown } from "../executor"

describe("pdf-to-markdown executor", () => {
  it("rejects non-pdf input", async () => {
    await expect(executePdfToMarkdown({
      inputPath: "/tmp/source.docx",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })
})


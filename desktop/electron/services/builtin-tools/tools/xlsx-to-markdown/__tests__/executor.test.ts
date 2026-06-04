import { describe, expect, it } from "vitest"

import { executeXlsxToMarkdown } from "../executor"

describe("xlsx-to-markdown executor", () => {
  it("rejects non-xlsx input", async () => {
    await expect(executeXlsxToMarkdown({
      inputPath: "/tmp/source.docx",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })
})


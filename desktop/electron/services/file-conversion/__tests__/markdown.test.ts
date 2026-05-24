import { describe, expect, it } from "vitest"

import { markdownTable, normalizeMarkdownTitle, sourceFrontmatter } from "../markdown"

describe("file conversion markdown helpers", () => {
  it("normalizes empty titles to the source file name", () => {
    expect(normalizeMarkdownTitle("", "/tmp/季度报告.docx")).toBe("季度报告.docx")
  })

  it("renders markdown tables with escaped cells", () => {
    expect(markdownTable([
      ["Name", "Value"],
      ["A|B", "12"],
    ])).toBe([
      "| Name | Value |",
      "| --- | --- |",
      "| A\\|B | 12 |",
      "",
    ].join("\n"))
  })

  it("serializes source conversion frontmatter", () => {
    expect(sourceFrontmatter({
      sourceOriginal: "_attachments/originals/2026/05/23/report.docx",
      sourceFormat: "docx",
      convertedAt: "2026-05-23T13:00:00.000Z",
    })).toContain('source_format: "docx"')
  })
})

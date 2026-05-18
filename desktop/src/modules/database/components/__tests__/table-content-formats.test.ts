import { describe, expect, it } from "vitest"

import { formatTableContent } from "../table-content-formats"

describe("formatTableContent", () => {
  it("escapes formula-like CSV cells as text", () => {
    const csv = formatTableContent({
      tableName: "export",
      columns: [{ name: "value", kind: "text" }],
      rows: [
        { value: "=HYPERLINK(\"https://example.test\", \"open\")" },
        { value: "+1+1" },
        { value: "-1+1" },
        { value: "@SUM(1,1)" },
        { value: "\t=SUM(1,1)" },
        { value: "\r=SUM(1,1)" },
        { value: "plain text" },
      ],
    }, "csv")

    expect(csv).toBe([
      "value",
      "\"'=HYPERLINK(\"\"https://example.test\"\", \"\"open\"\")\"",
      "'+1+1",
      "'-1+1",
      "\"'@SUM(1,1)\"",
      "\"'\t=SUM(1,1)\"",
      "\"'\r=SUM(1,1)\"",
      "plain text",
    ].join("\n"))
  })
})

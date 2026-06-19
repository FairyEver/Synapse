import { afterEach, describe, expect, it, vi } from "vitest"

import { downloadTableContent, formatTableContent } from "../table-content-formats"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

describe("downloadTableContent", () => {
  it.each([
    { tableName: "CON", format: "csv" as const, expected: "_CON.csv" },
    { tableName: "NUL", format: "xlsx" as const, expected: "_NUL.xlsx" },
    { tableName: "report.", format: "csv" as const, expected: "report.csv" },
    { tableName: "report ", format: "xlsx" as const, expected: "report.xlsx" },
  ])("uses a Windows-safe file name for $tableName downloads", ({ tableName, format, expected }) => {
    const downloads: string[] = []
    const link = {
      href: "",
      download: "",
      click: vi.fn(() => downloads.push(link.download)),
    }
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal("document", {
      createElement: vi.fn((tagName: string) => {
        expect(tagName).toBe("a")
        return link
      }),
    })

    downloadTableContent({
      tableName,
      columns: [{ name: "value", kind: "text" }],
      rows: [{ value: "first" }],
    }, format)

    expect(downloads).toEqual([expected])
  })
})

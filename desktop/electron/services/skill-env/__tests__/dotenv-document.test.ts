import { describe, expect, it } from "vitest"

import {
  createDotenvFromExample,
  mergeDotenvExample,
  parseDotenvDocument,
  patchDotenvValues,
} from "../dotenv-document"

describe("dotenv document", () => {
  it("parses comments, export, quoted multiline values, and CRLF", () => {
    const input = "# config\r\nexport TOKEN='old'\r\nMULTI=\"a\r\nb\"\r\n"
    const parsed = parseDotenvDocument(input)
    expect(parsed.newline).toBe("\r\n")
    expect(parsed.entries.map((entry) => [entry.name, entry.value, entry.line])).toEqual([
      ["TOKEN", "old", 2],
      ["MULTI", "a\nb", 3],
    ])
  })

  it("rejects duplicate names case-insensitively", () => {
    expect(() => parseDotenvDocument("TOKEN=one\ntoken=two\n"))
      .toThrow("配置键重复：token")
  })

  it("patches only the selected raw value", () => {
    const input = "# keep\nTOKEN = old # keep comment\nOTHER='same'\n"
    const next = patchDotenvValues(input, { token: "new value" })
    expect(next).toBe("# keep\nTOKEN = \"new value\" # keep comment\nOTHER='same'\n")
  })

  it("creates and merges without deleting user keys", () => {
    expect(createDotenvFromExample("TOKEN=\nURL=https://example.com\n", { TOKEN: "secret" }))
      .toBe("TOKEN=\"secret\"\nURL=https://example.com\n")
    expect(mergeDotenvExample("TOKEN=old\nCUSTOM=yes\n", "TOKEN=\nNEW_KEY=default\n", {}))
      .toBe("TOKEN=old\nCUSTOM=yes\nNEW_KEY=default\n")
  })
})

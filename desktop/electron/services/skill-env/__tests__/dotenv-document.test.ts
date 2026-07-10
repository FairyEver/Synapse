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

  it("serializes replacement values losslessly through Node parseEnv", () => {
    const values = {
      BACKSLASH: String.raw`C:\tools\bin`,
      DOUBLE_QUOTE: 'say "hello"',
      MULTILINE: "first\nsecond",
      MIXED_QUOTES: `single ' and double "`,
    }
    const input = "BACKSLASH=\nDOUBLE_QUOTE=\nMULTILINE=\nMIXED_QUOTES=\n"
    const next = patchDotenvValues(input, values)
    const parsed = parseDotenvDocument(next)

    expect(Object.fromEntries(parsed.entries.map((entry) => [entry.name, entry.value])))
      .toEqual(values)
    expect(next).toContain('BACKSLASH="C:\\tools\\bin"')
    expect(next).toContain("DOUBLE_QUOTE='say \"hello\"'")
    expect(next).toContain('MULTILINE="first\nsecond"')
    expect(next).toContain("MIXED_QUOTES=`single ' and double \"`")
  })

  it("rejects values containing all supported quote delimiters", () => {
    expect(() => patchDotenvValues("TOKEN=\n", { TOKEN: "'\"`" }))
      .toThrow("配置值无法无损写入：TOKEN")
  })

  it("rejects NUL replacement values for patch, create, and merge", () => {
    const invalid = { TOKEN: "before\0after" }
    expect(() => patchDotenvValues("TOKEN=\n", invalid))
      .toThrow("配置值不能包含 NUL 字节：TOKEN")
    expect(() => createDotenvFromExample("TOKEN=\n", invalid))
      .toThrow("配置值不能包含 NUL 字节：TOKEN")
    expect(() => mergeDotenvExample("EXISTING=old\n", "TOKEN=\n", invalid))
      .toThrow("配置值不能包含 NUL 字节：TOKEN")
  })

  it("creates and merges without deleting user keys", () => {
    expect(createDotenvFromExample("TOKEN=\nURL=https://example.com\n", { TOKEN: "secret" }))
      .toBe("TOKEN=\"secret\"\nURL=https://example.com\n")
    expect(mergeDotenvExample("TOKEN=old\nCUSTOM=yes\n", "TOKEN=\nNEW_KEY=default\n", {}))
      .toBe("TOKEN=old\nCUSTOM=yes\nNEW_KEY=default\n")
  })

  it("keeps existing declarations while applying confirmed values to new declarations", () => {
    expect(mergeDotenvExample(
      "TOKEN=existing\nCUSTOM=user-only\n",
      "TOKEN=default\nNEW_KEY=default\nEMPTY=\n",
      { TOKEN: "submitted", NEW_KEY: "confirmed", EMPTY: "filled" },
    )).toBe("TOKEN=existing\nCUSTOM=user-only\nNEW_KEY=\"confirmed\"\nEMPTY=\"filled\"\n")
  })
})

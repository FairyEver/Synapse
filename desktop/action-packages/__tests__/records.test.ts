import { describe, expect, it } from "vitest"

import { parseRecordText, stringifyRecordText, tryParseRecordText } from "../records"

describe("action package record text utilities", () => {
  it("parses KEY=value lines and preserves values after the first equals sign", () => {
    expect(parseRecordText("A=1\nTOKEN=a=b\n\n")).toEqual({
      A: "1",
      TOKEN: "a=b",
    })
  })

  it("rejects lines without a key", () => {
    expect(() => parseRecordText("=missing")).toThrow(/名称不能为空/)
  })

  it("rejects lines without an equals sign", () => {
    expect(() => parseRecordText("TOKEN")).toThrow(/KEY=value/)
  })

  it("returns parse failures without throwing", () => {
    const result = tryParseRecordText("TOKEN")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/KEY=value/)
    }
  })

  it("stringifies records as newline-delimited entries", () => {
    expect(stringifyRecordText({ A: "1", TOKEN: "a=b" })).toBe("A=1\nTOKEN=a=b")
  })
})

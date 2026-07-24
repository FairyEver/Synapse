import { describe, expect, it } from "vitest"
import {
  CLIPBOARD_TEXT_MAX_BYTES,
  validateClipboardReadText,
  validateClipboardWriteText,
} from "../schema"

describe("Clipboard text validation", () => {
  it("accepts whitespace and preserves valid text exactly", () => {
    expect(validateClipboardWriteText(" \r\n\t ")).toEqual({
      ok: true,
      text: " \r\n\t ",
    })
    expect(validateClipboardWriteText("e\u0301😀")).toEqual({
      ok: true,
      text: "e\u0301😀",
    })
  })

  it("accepts empty reads but rejects empty writes", () => {
    expect(validateClipboardReadText("")).toEqual({ ok: true, text: "" })
    expect(validateClipboardWriteText("")).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        data: { field: "text", reason: "empty" },
      },
    })
  })

  it("rejects NUL and unpaired surrogates before UTF-8 encoding", () => {
    expect(validateClipboardWriteText("a\u0000b")).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        data: { reason: "forbidden_character" },
      },
    })
    expect(validateClipboardWriteText("\ud800")).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        data: { reason: "invalid_unicode" },
      },
    })
  })

  it("uses the actual UTF-8 byte length with a 1 MiB inclusive limit", () => {
    expect(validateClipboardWriteText("a".repeat(CLIPBOARD_TEXT_MAX_BYTES)).ok).toBe(true)
    expect(validateClipboardWriteText("a".repeat(CLIPBOARD_TEXT_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      error: { code: "TEXT_TOO_LARGE" },
    })
    expect(validateClipboardReadText("中".repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / 3) + 1)))
      .toMatchObject({
        ok: false,
        error: { code: "TEXT_TOO_LARGE" },
      })
  })
})

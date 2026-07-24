import { describe, expect, it } from "vitest"
import {
  JSON_REPAIR_INPUT_MAX_BYTES,
  utf8ByteLength,
  validateJsonRepairInput,
} from "../schema"

describe("validateJsonRepairInput", () => {
  it.each([
    [null, "request", "type"],
    [[], "request", "type"],
    [{}, "text", "required"],
    [{ text: 1 }, "text", "type"],
    [{ text: " \n\t" }, "text", "empty"],
    [{ text: "{}", extra: true }, "request", "unknown_field"],
    [{ text: "\ud800" }, "text", "invalid_unicode"],
  ])("returns the first stable input error", (request, field, reason) => {
    expect(validateJsonRepairInput(request)).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "JSON 修复输入无效。",
        retryable: false,
        data: { field, reason },
      },
    })
  })

  it("preserves valid multiline and control content", () => {
    const text = "\n{\"value\":\"a\\tb\"}\u0001\n"
    expect(validateJsonRepairInput({ text })).toEqual({
      ok: true,
      data: { text, inputBytes: utf8ByteLength(text) },
    })
  })

  it("uses UTF-8 bytes as the authoritative input limit", () => {
    const accepted = "a".repeat(JSON_REPAIR_INPUT_MAX_BYTES)
    const rejected = "你".repeat(Math.floor(JSON_REPAIR_INPUT_MAX_BYTES / 3) + 1)

    expect(validateJsonRepairInput({ text: accepted }).ok).toBe(true)
    expect(validateJsonRepairInput({ text: rejected })).toEqual({
      ok: false,
      error: {
        code: "INPUT_TOO_LARGE",
        message: "输入文本超过 128 KiB 限制。",
        retryable: false,
      },
    })
  })
})

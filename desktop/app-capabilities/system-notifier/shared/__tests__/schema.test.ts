import { describe, expect, it } from "vitest"
import {
  validateSystemNotificationInput,
  type SystemNotificationInvalidInput,
} from "../schema"

function invalid(input: unknown): SystemNotificationInvalidInput {
  const result = validateSystemNotificationInput(input)
  if (result.ok) throw new Error("Expected invalid input.")
  return result
}

describe("system notification input", () => {
  it("accepts exact single-line Unicode and counts code points", () => {
    const title = "😀".repeat(64)
    const body = `组合e\u0301${"文".repeat(252)}`
    expect(validateSystemNotificationInput({ title, body })).toEqual({
      ok: true,
      data: { title, body },
    })
  })

  it.each([
    [null, "request", "type"],
    [[], "request", "type"],
    [{ title: "标题", body: "正文", source: "tool" }, "request", "unknown_field"],
    [{ body: "正文" }, "title", "required"],
    [{ title: "", body: "正文" }, "title", "required"],
    [{ title: null, body: "正文" }, "title", "type"],
    [{ title: " 标题", body: "正文" }, "title", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "   " }, "body", "leading_or_trailing_whitespace"],
    [{ title: "\ud800", body: "正文" }, "title", "invalid_unicode"],
    [{ title: "标题\n换行", body: "正文" }, "title", "forbidden_character"],
    [{ title: "标题", body: "正文\u2029分段" }, "body", "forbidden_character"],
    [{ title: "😀".repeat(65), body: "正文" }, "title", "too_long"],
    [{ title: "标题", body: "文".repeat(257) }, "body", "too_long"],
  ])("returns one stable redacted error for %#", (input, field, reason) => {
    expect(invalid(input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      error: "Invalid system notification input.",
      data: { field, reason },
    })
  })

  it("uses request, title, body and field checks in the fixed first-error order", () => {
    expect(invalid({ title: 42, body: "\n", extra: true }).data).toEqual({
      field: "request",
      reason: "unknown_field",
    })
    expect(invalid({ title: 42, body: "\n" }).data).toEqual({
      field: "title",
      reason: "type",
    })
  })

  it("never serializes rejected content or actual lengths", () => {
    const secret = "sk-secret-value"
    const serialized = JSON.stringify(invalid({ title: secret.repeat(20), body: "正文" }))
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(String(secret.length * 20))
  })
})

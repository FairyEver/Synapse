/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { redactShareState, redactShareText } from "../redaction"

describe("share privacy", () => {
  it("redacts source and nested bound chart/form values without modifying original state", () => {
    const source = 'Text("mail me at test@example.com")'
    expect(redactShareText(source, true)).toBe('Text("mail me at ［邮箱已隐藏］")')
    expect(redactShareText(source, false)).toBe(source)
    const state = { rows: [{ contact: "test@example.com", count: 3 }], checked: true }
    expect(redactShareState(state)).toEqual({ rows: [{ contact: "［邮箱已隐藏］", count: 3 }], checked: true })
    expect(state.rows[0]!.contact).toBe("test@example.com")
  })
  it.each(["test&#64;example.com", "test&#x40;example&#46;com", "test&commat;example&period;com", "test&plus;@example.com", "test&amp;@example.com", "test\\@example.com", "test\\u0040example.com", "test\\x40example.com", "&#116;est@example.com"])("hides encoded or escaped email text without decoding surrounding syntax: %s", (email) => {
    expect(redactShareText(`Text("${email}")`, true)).toBe('Text("［邮箱已隐藏］")')
  })
  it("handles large non-email text without repeated backtracking over the whole message", () => {
    const text = "a".repeat(100_000) + "@invalid"
    expect(redactShareText(text, true)).toBe(text)
  })
})

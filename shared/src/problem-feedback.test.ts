import { describe, expect, it } from "vitest"
import {
  isProblemFeedbackInputField,
  isProblemFeedbackInputReason,
  isProblemFeedbackPrivacyCategory,
  PROBLEM_FEEDBACK_MAX_UTF8_BYTES,
  PROBLEM_FEEDBACK_PRIVACY_CATEGORIES,
  validateProblemFeedbackInput,
} from "./problem-feedback.js"
import { PROBLEM_FEEDBACK_POLICY_FIXTURES } from "./problem-feedback-fixtures.js"

describe("problem feedback policy", () => {
  it("owns the stable validation protocol guards", () => {
    expect(isProblemFeedbackInputField("content")).toBe(true)
    expect(isProblemFeedbackInputField("other")).toBe(false)
    expect(isProblemFeedbackInputReason("too_large")).toBe(true)
    expect(isProblemFeedbackInputReason("other")).toBe(false)
    expect(isProblemFeedbackPrivacyCategory("local_path")).toBe(true)
    expect(isProblemFeedbackPrivacyCategory("other")).toBe(false)
  })

  it.each(PROBLEM_FEEDBACK_POLICY_FIXTURES.valid)("$name", ({ input }) => {
    expect(validateProblemFeedbackInput(input)).toEqual({
      ok: true,
      data: { content: input.content },
    })
  })

  it.each(PROBLEM_FEEDBACK_POLICY_FIXTURES.invalidInput)(
    "returns the first stable input error for $name",
    ({ input, field, reason }) => {
      expect(validateProblemFeedbackInput(input)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        error: "Invalid problem feedback input.",
        data: { field, reason },
      })
    },
  )

  it.each(PROBLEM_FEEDBACK_POLICY_FIXTURES.privacy)(
    "rejects $category and permits its synthetic counterexample",
    ({ category, rejected, allowed }) => {
      expect(validateProblemFeedbackInput({ content: rejected })).toEqual({
        ok: false,
        code: "PRIVACY_RISK",
        error: "Problem feedback contains prohibited sensitive information.",
        data: { category },
      })
      expect(validateProblemFeedbackInput({ content: allowed })).toEqual({
        ok: true,
        data: { content: allowed },
      })
    },
  )

  it("uses the fixed privacy priority", () => {
    expect(PROBLEM_FEEDBACK_PRIVACY_CATEGORIES).toEqual([
      "authentication_secret",
      "local_path",
      "identity",
      "user_content",
      "unsafe_url",
      "correlation_identifier",
    ])
    expect(validateProblemFeedbackInput({
      content: "PIN: 1234\n路径：/usr/local/synthetic/private",
    })).toMatchObject({
      code: "PRIVACY_RISK",
      data: { category: "authentication_secret" },
    })
  })

  it("enforces exact UTF-8 bytes without normalizing or trimming", () => {
    const exact = "界".repeat(Math.floor(PROBLEM_FEEDBACK_MAX_UTF8_BYTES / 3))
      + "a".repeat(PROBLEM_FEEDBACK_MAX_UTF8_BYTES % 3)
    expect(new TextEncoder().encode(exact)).toHaveLength(PROBLEM_FEEDBACK_MAX_UTF8_BYTES)
    expect(validateProblemFeedbackInput({ content: exact })).toEqual({
      ok: true,
      data: { content: exact },
    })
    expect(validateProblemFeedbackInput({ content: `${exact}a` })).toMatchObject({
      code: "INVALID_INPUT",
      data: { field: "content", reason: "too_large" },
    })
  })

  it("preserves ordinary Unicode and LF exactly", () => {
    const content = "场景：e\u0301 与 😀。\n实际情况：原样保留。"
    expect(validateProblemFeedbackInput({ content })).toEqual({
      ok: true,
      data: { content },
    })
  })
})

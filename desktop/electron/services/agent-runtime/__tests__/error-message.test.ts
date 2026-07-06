import { describe, expect, it } from "vitest"

import {
  AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH,
  agentRuntimeErrorMessage,
  agentRuntimeErrorSummary,
} from "../error-message"

describe("agent runtime error message", () => {
  it("redacts sensitive tokens with shared rules", () => {
    const message = agentRuntimeErrorMessage(new Error([
      "Request failed",
      "Authorization: Bearer sk-live-secret-token",
      "github_pat_secretvalue",
      "https://user:pass@example.test/path",
      "api_key=plain-secret",
    ].join("\n")))

    expect(message).toContain("Request failed")
    expect(message.toLowerCase()).toContain("authorization")
    expect(message).toContain("[redacted]@example.test/path")
    expect(message).not.toContain("sk-live-secret-token")
    expect(message).not.toContain("github_pat_secretvalue")
    expect(message).not.toContain("plain-secret")
    expect(message).not.toContain("Bearer sk")
    expect(message).not.toContain("user:pass")
  })

  it("truncates by unicode runes", () => {
    const message = agentRuntimeErrorMessage(`错误${"界".repeat(AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH)}`)

    expect([...message]).toHaveLength(AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH)
    expect(message).toBe(`错误${"界".repeat(AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH - 2)}`)
  })

  it("sanitizes paths in summaries without changing ordinary messages", () => {
    const raw = "Failed at /Users/liyang/project/file.ts with token=secret-value"

    expect(agentRuntimeErrorMessage(raw)).toContain("/Users/liyang/project/file.ts")
    expect(agentRuntimeErrorSummary(raw)).toContain("[path redacted]")
    expect(agentRuntimeErrorSummary(raw)).not.toContain("secret-value")
  })
})

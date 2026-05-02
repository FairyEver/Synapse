import { describe, expect, it } from "vitest"
import { classifyGitFailure, formatGitFailureMessage } from "../git-error-utils"

describe("git-error-utils", () => {
  it("classifies network failures as recoverable", () => {
    const result = classifyGitFailure("fatal: unable to access: Could not resolve host: github.com", "fallback")

    expect(result.category).toBe("network")
    expect(result.recoverable).toBe(true)
    expect(result.message).toBe("网络不可用，稍后自动重试。")
  })

  it("classifies timeouts as recoverable", () => {
    const result = classifyGitFailure("fatal: connection timed out", "fallback")

    expect(result.category).toBe("timeout")
    expect(result.recoverable).toBe(true)
  })

  it("classifies authentication failures as attention", () => {
    const result = classifyGitFailure("Permission denied (publickey).", "fallback")

    expect(result.category).toBe("auth")
    expect(result.recoverable).toBe(false)
    expect(result.primaryAction).toBe("resolve-git")
  })

  it("keeps formatGitFailureMessage compatible", () => {
    expect(formatGitFailureMessage("fatal: not a git repository", "fallback"))
      .toBe("当前目录不是 Git 仓库。")
  })
})

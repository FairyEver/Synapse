import { describe, expect, it } from "vitest"
import { classifyGitFailure, formatGitFailureMessage, isNonFastForwardError } from "../git-error-utils"

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

  it.each([
    "fatal: repository not found",
    "fatal: remote origin not found",
    "fatal: no such remote 'origin'",
  ])("preserves remote missing compatibility message for %s", (output) => {
    const result = classifyGitFailure(output, "fallback")

    expect(result.category).toBe("upstream-missing")
    expect(result.recoverable).toBe(false)
    expect(result.primaryAction).toBe("resolve-git")
    expect(result.message).toBe("当前仓库没有可用的远程配置，或当前账号没有访问权限。")
    expect(result.message).not.toContain(output)
  })

  it("keeps formatGitFailureMessage compatible", () => {
    expect(formatGitFailureMessage("fatal: not a git repository", "fallback"))
      .toBe("当前目录不是 Git 仓库。")
  })

  it.each([
    "fatal: Not possible to fast-forward, aborting.",
    "Updates were rejected because the tip of your current branch is behind",
    "! [rejected] main -> main (fetch first)",
    "hint: Updates were rejected because of a non-fast-forward update.",
  ])("detects non-fast-forward git output: %s", (output) => {
    expect(isNonFastForwardError(output)).toBe(true)
  })
})

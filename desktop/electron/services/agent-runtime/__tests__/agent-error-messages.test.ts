import { describe, expect, it } from "vitest"

import {
  sdkQueryErrorMessage,
  sdkResultErrorMessage,
} from "../agent-error-messages"

describe("agent error messages", () => {
  it("maps WebFetch domain preflight failures to a concise user message", () => {
    const raw = [
      "AxiosError: Request failed with status code 403",
      "at Or (/$bunfs/root/src/entrypoints/cli.js:116:1194)",
      "DomainCheckFailedError: Unable to verify if domain help.aliyun.com is safe to fetch. This may be due to network restrictions or enterprise security policies blocking claude.ai.",
      "Authorization: Bearer sk-secret",
    ].join("\n")

    const message = sdkQueryErrorMessage(raw)

    expect(message).toBe("WebFetch 域名预检失败。当前供应商或网络拒绝了 Claude Code 的安全检查，已停止本轮执行。")
    expect(message).not.toContain("$bunfs")
    expect(message).not.toContain("sk-secret")
    expect(message).not.toContain("Bearer")
  })

  it("maps WebFetch domain preflight result errors without exposing stack text", () => {
    const message = sdkResultErrorMessage(undefined, [
      "DomainCheckFailedError: Unable to verify if domain www.aliyun.com is safe to fetch.",
      "AxiosError: Request failed with status code 403",
      "at emit (node:events:92:22)",
    ])

    expect(message).toBe("WebFetch 域名预检失败。当前供应商或网络拒绝了 Claude Code 的安全检查，已停止本轮执行。")
  })

  it("keeps max turns and ordinary SDK error messages unchanged", () => {
    expect(sdkResultErrorMessage("error_max_turns", [])).toContain("已达到本轮执行上限")
    expect(sdkQueryErrorMessage("plain failure")).toBe("Agent 执行失败。诊断信息：plain failure")
  })

  it("maps tool-use interrupted diagnostics to a recoverable user message", () => {
    const raw = "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"

    const message = sdkQueryErrorMessage(raw)

    expect(message).toBe("Agent 在工具调用后中断，发送“继续”可接着执行。")
    expect(message).not.toContain("ede_diagnostic")
    expect(message).not.toContain("stop_reason")
  })
})

import { describe, expect, it } from "vitest"

import { formatStartupFailureDialogMessage } from "../startup-error"

describe("startup failure dialog", () => {
  it("keeps the raw startup error, framed as technical detail", () => {
    const message = formatStartupFailureDialogMessage(new Error("EADDRINUSE port 12345"))

    // The raw text is still there — a user who cannot start the app has nothing else to send.
    expect(message).toContain("EADDRINUSE port 12345")
    // But it is labelled, so an English driver message does not read as the explanation.
    expect(message).toContain("技术信息：EADDRINUSE port 12345")
    expect(message).toContain("请查看应用日志获取更多信息。")
    expect(message).not.toContain("磁盘空间")
    expect(message).not.toContain("文件权限")
  })

  it("bounds a long startup error instead of dropping it in whole", () => {
    // The dialog used to take whatever length the error had. It still reports the start of the
    // text, so a long driver message stays identifiable rather than being cut off entirely.
    const message = formatStartupFailureDialogMessage(new Error(`EADDRINUSE ${"x".repeat(5000)}`))

    expect(message).toContain("技术信息：EADDRINUSE ")
    expect(message.length).toBeLessThan(1_200)
  })

  it("uses a fallback for empty startup errors", () => {
    expect(formatStartupFailureDialogMessage("")).toContain("未知错误")
  })
})

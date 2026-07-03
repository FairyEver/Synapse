import { describe, expect, it } from "vitest"

import { formatStartupFailureDialogMessage } from "../startup-error"

describe("startup failure dialog", () => {
  it("keeps the startup error message without a fixed disk or permission hint", () => {
    const message = formatStartupFailureDialogMessage(new Error("EADDRINUSE port 12345"))

    expect(message).toContain("EADDRINUSE port 12345")
    expect(message).toContain("请查看应用日志获取更多信息。")
    expect(message).not.toContain("磁盘空间")
    expect(message).not.toContain("文件权限")
  })

  it("uses a fallback for empty startup errors", () => {
    expect(formatStartupFailureDialogMessage("")).toContain("未知错误")
  })
})

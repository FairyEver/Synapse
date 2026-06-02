import { describe, expect, it } from "vitest"

import { getUsageRefreshWarning } from "../shared/refresh-result"

describe("getUsageRefreshWarning", () => {
  it("returns no warning when all files refresh cleanly", () => {
    expect(getUsageRefreshWarning({ failedFiles: 0 })).toBeNull()
  })

  it("mentions partial refresh failures", () => {
    expect(getUsageRefreshWarning({ failedFiles: 2 })).toBe("刷新完成，2 个文件处理失败，报告可能不完整。")
  })
})

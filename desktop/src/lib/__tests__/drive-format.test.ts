import { describe, expect, it } from "vitest"

import { driveErrorMessage, formatDriveBytes, readableDriveErrorMessage } from "../drive-format"

describe("drive-format", () => {
  it("formats byte counts consistently", () => {
    expect(formatDriveBytes("0")).toBe("0 B")
    expect(formatDriveBytes("-1")).toBe("0 B")
    expect(formatDriveBytes("invalid")).toBe("0 B")
    expect(formatDriveBytes("50")).toBe("50 B")
    expect(formatDriveBytes("1536")).toBe("1.5 KB")
  })

  it("removes IPC and Error prefixes from Drive error messages", () => {
    expect(readableDriveErrorMessage("Error invoking remote method 'synapse:app:drive:operation:list': Error: 文件不存在"))
      .toBe("文件不存在")
    expect(driveErrorMessage(new Error("Error: 保存失败"), "操作失败")).toBe("保存失败")
    expect(driveErrorMessage(new Error("  "), "操作失败")).toBe("操作失败")
    expect(driveErrorMessage("failed", "操作失败")).toBe("操作失败")
  })
})

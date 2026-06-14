import { describe, expect, it, vi } from "vitest"
import {
  createEditorWriteErrorLogMeta,
  formatEditorWriteFailure,
} from "../editor-file-write-utils"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe("editor file write utils", () => {
  it("projects write errors without raw filesystem messages", () => {
    const error = Object.assign(
      new Error("rename /Users/alice/private/token-dir accessToken=secret Authorization: Bearer raw-token"),
      { code: "EACCES" },
    )

    const meta = createEditorWriteErrorLogMeta(error)
    const serialized = JSON.stringify(meta)

    expect(meta).toEqual({
      errorName: "Error",
      errorCode: "EACCES",
    })
    expect(serialized).not.toContain("/Users/alice")
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("raw-token")
  })

  it("formats write failures without exposing raw paths or secrets to the UI", () => {
    const formatted = formatEditorWriteFailure(
      new Error("write /Users/alice/private/skill.md apiKey=secret"),
      "/Users/alice/private/skill.md",
    )

    expect(formatted.message).toBe("写入失败，请稍后重试。")
    expect(formatted.message).not.toContain("/Users/alice")
    expect(formatted.message).not.toContain("secret")
  })
})

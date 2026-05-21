import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("task scheduler export feedback", () => {
  it("notifies the user after a successful export", async () => {
    const source = await readFile(
      new URL("../index.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain('notify({ message: "任务已导出。", tone: "success" })')
  })
})

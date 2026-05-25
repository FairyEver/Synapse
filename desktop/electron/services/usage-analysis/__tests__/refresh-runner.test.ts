import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveUsageRefreshWorkerPath } from "../refresh-runner"

describe("usage analysis refresh runner", () => {
  it("uses the compiled worker next to the runner in development", () => {
    expect(resolveUsageRefreshWorkerPath("/repo/desktop/dist-electron/electron/services/usage-analysis")).toBe(
      path.join("/repo/desktop/dist-electron/electron/services/usage-analysis", "refresh-worker.js"),
    )
  })

  it("uses the unpacked worker script in a packaged asar app", () => {
    expect(resolveUsageRefreshWorkerPath("/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/usage-analysis")).toBe(
      path.join("/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/dist-electron/electron/services/usage-analysis", "refresh-worker.js"),
    )
  })

  it("uses the unpacked worker script when the base path uses Windows separators", () => {
    const baseDir = "C:\\Program Files\\Synapse\\resources\\app.asar\\dist-electron\\electron\\services\\usage-analysis"

    expect(resolveUsageRefreshWorkerPath(baseDir)).toContain("app.asar.unpacked")
  })
})

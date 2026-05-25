import path from "node:path"
import { readFileSync } from "node:fs"
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

  it("keeps packaged worker dependencies unpacked with the worker", () => {
    const packageJson = JSON.parse(readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")) as {
      build?: { asarUnpack?: string[] }
    }

    expect(packageJson.build?.asarUnpack).toContain("dist-electron/electron/services/usage-analysis/**")
    expect(packageJson.build?.asarUnpack).not.toContain("dist-electron/electron/services/usage-analysis/refresh-worker.js")
  })
})

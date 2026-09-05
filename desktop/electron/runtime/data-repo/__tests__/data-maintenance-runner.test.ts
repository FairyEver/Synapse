import path from "node:path"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { resolveDataMaintenanceWorkerPath } from "../maintenance/runner"

describe("data maintenance Worker path", () => {
  it("uses the compiled Worker beside the runner in development", () => {
    expect(resolveDataMaintenanceWorkerPath(
      "/repo/desktop/dist-electron/electron/runtime/data-repo/maintenance",
    )).toBe(path.join(
      "/repo/desktop/dist-electron/electron/runtime/data-repo/maintenance",
      "worker.js",
    ))
  })

  it("redirects packaged Workers to app.asar.unpacked", () => {
    expect(resolveDataMaintenanceWorkerPath(
      "/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/runtime/data-repo/maintenance",
    )).toBe(path.join(
      "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/dist-electron/electron/runtime/data-repo/maintenance",
      "worker.js",
    ))
  })

  it("redirects Windows packaged Worker paths", () => {
    expect(resolveDataMaintenanceWorkerPath(
      "C:\\Program Files\\Synapse\\resources\\app.asar\\dist-electron\\electron\\runtime\\data-repo\\maintenance",
    )).toContain("app.asar.unpacked")
  })

  it("keeps the maintenance Worker closure unpacked", () => {
    const packageJson = JSON.parse(readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")) as {
      build?: { asarUnpack?: string[] }
    }
    expect(packageJson.build?.asarUnpack).toContain(
      "dist-electron/electron/runtime/data-repo/maintenance/**",
    )
  })
})

import path from "node:path"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import {
  resetUsageRefreshSingleFlightForTests,
  resolveUsageRefreshWorkerPath,
  runSingleFlightUsageRefresh,
} from "../refresh-runner"

afterEach(() => {
  resetUsageRefreshSingleFlightForTests()
})

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
    expect(packageJson.build?.asarUnpack).toContain("dist-electron/src/**")
    expect(packageJson.build?.asarUnpack).toContain("dist-electron/action-packages/shared/**")
    expect(packageJson.build?.asarUnpack).not.toContain("dist-electron/electron/services/usage-analysis/refresh-worker.js")
  })

  it("keeps the refresh worker closure independent from main-process services", () => {
    const workerSources = [
      "../refresh-worker.ts",
      "../db-schema.ts",
      "../currency-migration.ts",
      "../cc-service.ts",
    ].map((relativePath) => readFileSync(path.join(__dirname, relativePath), "utf8"))

    for (const source of workerSources) {
      expect(source).not.toContain("../error-sanitize")
      expect(source).not.toContain("../log-store")
    }
  })

  it("keeps compiled usage analysis src dependencies in the unpacked closure", () => {
    const packageJson = JSON.parse(readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")) as {
      build?: { asarUnpack?: string[] }
    }
    const desktopRoot = path.join(__dirname, "../../../..")
    const usageAnalysisOutDir = path.join(desktopRoot, "dist-electron/electron/services/usage-analysis")

    if (!existsSync(usageAnalysisOutDir)) {
      expect(packageJson.build?.asarUnpack).toContain("dist-electron/src/**")
      return
    }

    const sourceRequires = readdirSync(usageAnalysisOutDir)
      .filter((entry) => entry.endsWith(".js"))
      .flatMap((entry) => {
        const filePath = path.join(usageAnalysisOutDir, entry)
        const source = readFileSync(filePath, "utf8")
        return [...source.matchAll(/require\(["'](\.\.\/\.\.\/\.\.\/src\/[^"']+)["']\)/g)]
          .map((match) => ({
            importer: entry,
            request: match[1],
            target: path.join(usageAnalysisOutDir, match[1] ?? ""),
          }))
      })

    expect(sourceRequires).not.toEqual([])
    expect(packageJson.build?.asarUnpack).toContain("dist-electron/src/**")
    for (const dependency of sourceRequires) {
      expect(existsSync(`${dependency.target}.js`), `${dependency.importer} requires ${dependency.request}`).toBe(true)
    }
  })

  it("coalesces concurrent refreshes for the same database namespace", async () => {
    let calls = 0
    const input = { dbPath: "/tmp/usage.db", prefix: "cc" as const, roots: ["/tmp/projects"] }
    const result = {
      scannedFiles: 1,
      parsedFiles: 1,
      skippedFiles: 0,
      failedFiles: 0,
      usageEvents: 1,
      toolEvents: 0,
      elapsedMs: 1,
    }
    let resolveRefresh: (value: typeof result) => void = () => {
      throw new Error("Refresh promise was not created")
    }
    const runner = async () => {
      calls += 1
      return await new Promise<typeof result>((resolve) => {
        resolveRefresh = resolve
      })
    }

    const first = runSingleFlightUsageRefresh(input, runner)
    const second = runSingleFlightUsageRefresh(input, runner)
    resolveRefresh(result)

    await expect(first).resolves.toBe(result)
    await expect(second).resolves.toBe(result)
    expect(calls).toBe(1)
  })
})

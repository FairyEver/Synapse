import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createInstallSourceMetadata,
  isVersionNewerOrEqual,
  parseComparableVersion,
} from "../../electron/services/install-source-metadata"

describe("install source metadata", () => {
  it("matches CC Connect npm wrapper version ordering", () => {
    expect(isVersionNewerOrEqual("1.2.3", "1.2.3-beta.1")).toBe(true)
    expect(isVersionNewerOrEqual("1.2.3-beta.1", "1.2.3")).toBe(false)
    expect(isVersionNewerOrEqual("1.2.3-beta.10", "1.2.3-beta.2")).toBe(true)
    expect(isVersionNewerOrEqual("1.2.3-rc.1", "1.2.3-beta.9")).toBe(true)
  })

  it("parses pre-release versions with optional v prefix", () => {
    expect(parseComparableVersion("v1.2.3-beta.10")).toEqual({
      nums: [1, 2, 3],
      preTag: "beta",
      preNum: 10,
      hasPre: true,
    })
  })

  it("detects the CC Connect npm wrapper metadata without running install scripts", () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "synapse-install-source-"))
    const packageDir = path.join(rootDir, "node_modules", "cc-connect")
    const binDir = path.join(packageDir, "bin")
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "cc-connect",
        version: "v1.0.0",
        bin: { "cc-connect": "run.js" },
        scripts: { postinstall: "node install.js" },
      }),
    )

    const metadata = createInstallSourceMetadata({
      appVersion: "0.2.19",
      execPath: path.join(binDir, "cc-connect"),
      isPackaged: true,
      platform: "darwin",
      installedBinaryVersion: "1.0.0",
    })

    expect(metadata).toMatchObject({
      source: "npm-wrapper",
      packageName: "cc-connect",
      packageVersion: "v1.0.0",
      expectedBinaryName: "cc-connect",
      versionStatus: "matching",
      message: "npm wrapper",
    })
    expect(metadata.wrapperScriptPath).toBe(path.join(packageDir, "run.js"))
  })

  it("falls back to development metadata when not packaged", () => {
    const metadata = createInstallSourceMetadata({
      appVersion: "0.2.19",
      execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
      isPackaged: false,
      platform: "darwin",
    })

    expect(metadata).toMatchObject({
      source: "development",
      packageName: "@synapse/desktop",
      packageVersion: "0.2.19",
      message: "开发环境",
    })
  })
})
